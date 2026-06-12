import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  Connection,
  Keypair,
  type Transaction,
} from "@solana/web3.js";
import { buildDopplerDeployTransactions } from "./build-deploy-transaction.js";
import { decodeSolanaPublicKey } from "./public-key.js";
import {
  DEFAULT_SOLANA_CONFIG_PATH,
  loadSolanaCliConfig,
} from "./solana-config.js";

export type DeployOptions = {
  bytecodePath: string;
  programKeypairPath: string;
  admin: string;
  signerKeypairPath?: string;
  network?: string;
  configPath?: string;
};

export type DeployResult = {
  programId: string;
  admin: string;
  network: string;
};

type Manifest = {
  admin?: string;
  programId?: string;
};

async function assertFileExists(path: string, label: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(`${label} not found: ${path}`);
  }
}

async function loadKeypairFromFile(path: string): Promise<Keypair> {
  const secret = JSON.parse(await readFile(path, "utf8")) as number[];
  if (!Array.isArray(secret) || secret.length !== 64) {
    throw new Error(`Invalid keypair file: ${path}`);
  }

  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function validateManifest(
  bytecodePath: string,
  admin: string,
  programId: string,
): Promise<void> {
  const manifestPath = resolve(dirname(bytecodePath), "manifest.json");

  try {
    await access(manifestPath);
  } catch {
    return;
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;

  if (manifest.admin && manifest.admin !== admin) {
    throw new Error(
      `Admin '${admin}' does not match manifest admin '${manifest.admin}' (${manifestPath})`,
    );
  }

  if (manifest.programId && manifest.programId !== programId) {
    throw new Error(
      `Program ID '${programId}' does not match manifest programId '${manifest.programId}' (${manifestPath})`,
    );
  }
}

function signersForDeployTransaction(
  index: number,
  transactionCount: number,
  signerKeypair: Keypair,
  programKeypair: Keypair,
): Keypair[] {
  if (index === transactionCount - 1) {
    return [signerKeypair, programKeypair];
  }

  // Buffer init is already partial-signed by the ephemeral buffer keypair.
  return [signerKeypair];
}

/**
 * Adds any missing signatures, sends the serialized transaction, and confirms
 * against the blockhash already attached to the transaction.
 */
async function partialSignSendAndConfirm(
  connection: Connection,
  transaction: Transaction,
  signers: Keypair[],
): Promise<void> {
  if (signers.length > 0) {
    await transaction.partialSign(...signers);
  }

  const blockhash = transaction.recentBlockhash;
  const lastValidBlockHeight = transaction.lastValidBlockHeight;
  if (blockhash == null || lastValidBlockHeight == null) {
    throw new Error("Transaction is missing blockhash lifetime");
  }

  const signature = await connection.sendRawTransaction(await transaction.serialize(), {
    skipPreflight: false,
  });

  const { value } = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
  );

  if (value.err) {
    throw new Error(`Transaction ${signature} failed: ${JSON.stringify(value.err)}`);
  }
}

/** Sends and confirms transactions sequentially. */
async function sendDeployTransactions(
  connection: Connection,
  transactions: Transaction[],
  signerKeypair: Keypair,
  programKeypair: Keypair,
): Promise<void> {
  for (let index = 0; index < transactions.length; index++) {
    const transaction = transactions[index]!;
    const signers = signersForDeployTransaction(
      index,
      transactions.length,
      signerKeypair,
      programKeypair,
    );

    await partialSignSendAndConfirm(connection, transaction, signers);
  }
}

export async function deployDopplerProgram(options: DeployOptions): Promise<DeployResult> {
  const bytecodePath = resolve(options.bytecodePath);
  const programKeypairPath = resolve(options.programKeypairPath);
  const configPath = resolve(options.configPath ?? DEFAULT_SOLANA_CONFIG_PATH);

  decodeSolanaPublicKey(options.admin);

  await assertFileExists(bytecodePath, "Bytecode file");
  await assertFileExists(programKeypairPath, "Program keypair file");

  const config = await loadSolanaCliConfig(configPath);
  const signerKeypairPath = resolve(options.signerKeypairPath ?? config.keypairPath);
  const network = options.network ?? config.jsonRpcUrl;

  await assertFileExists(signerKeypairPath, "Signer keypair file");

  const [bytecode, programKeypair, signerKeypair] = await Promise.all([
    readFile(bytecodePath).then((buffer) => new Uint8Array(buffer)),
    loadKeypairFromFile(programKeypairPath),
    loadKeypairFromFile(signerKeypairPath),
  ]);

  const programId = programKeypair.publicKey.toBase58();
  await validateManifest(bytecodePath, options.admin, programId);

  const connection = new Connection(network);
  const { transactions } = await buildDopplerDeployTransactions({
    connection,
    payer: signerKeypair.publicKey,
    programId: programKeypair.publicKey,
    bytecode,
  });

  await sendDeployTransactions(connection, transactions, signerKeypair, programKeypair);

  return {
    programId,
    admin: options.admin,
    network,
  };
}
