import {
  Address,
  type Blockhash,
  type Commitment,
  type Connection,
  Keypair,
  PACKET_DATA_SIZE,
  SIGNATURE_LENGTH_IN_BYTES,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import { renderDopplerAssembly } from "./assembly.js";
import { compileAssemblyToBytecode } from "./bytecode.js";
import {
  loadGeneratorConfig,
  type ConfigOverrides,
  type DopplerGeneratorConfig,
} from "./config.js";
import {
  LoaderV3Program,
  UPGRADEABLE_LOADER_BUFFER_METADATA_SIZE,
  UPGRADEABLE_LOADER_PROGRAM_SIZE,
} from "./programs/loader-v3.js";

type BuildDopplerDeployTransactionsBase = {
  connection: Connection;
  programId: Address;
  payer: Address;
  upgradeAuthority?: Address;
  /** Maximum program data length. */
  maxDataLen?: number;
  commitment?: Commitment;
};

export type BuildDopplerDeployTransactionsInput = BuildDopplerDeployTransactionsBase &
  (
    | { bytecode: Uint8Array }
    | { config: DopplerGeneratorConfig }
    | { schemaFile: string; overrides?: ConfigOverrides }
  );

export type DopplerDeployTransactionBundle = {
  transactions: Transaction[];
  programId: string;
  programDataAddress: string;
  maxDataLen: number;
};

export function compileDopplerBytecode(config: DopplerGeneratorConfig): Uint8Array {
  const assembly = renderDopplerAssembly({
    admin: config.admin,
    payloadSize: config.layout.payloadSize,
  });
  return compileAssemblyToBytecode(assembly, config.arch);
}

export async function buildDopplerDeployTransactions(
  input: BuildDopplerDeployTransactionsInput,
): Promise<DopplerDeployTransactionBundle> {
  const bytecode = await resolveBytecode(input);
  const payer = input.payer;
  const upgradeAuthority = input.upgradeAuthority ?? payer;
  const bufferKeypair = await Keypair.generate();
  const programAddress = input.programId;
  const maxDataLen = input.maxDataLen ?? Math.max(bytecode.length * 2, bytecode.length);
  const commitment = input.commitment ?? "confirmed";

  const [programDataAddress] = await Address.findProgramAddress(
    [programAddress.toBytes()],
    LoaderV3Program.programId,
  );

  const [{ blockhash, lastValidBlockHeight }, bufferRent, programRent] = await Promise.all([
    input.connection.getLatestBlockhash(commitment),
    input.connection.getMinimumBalanceForRentExemption(sizeOfBuffer(bytecode.length)),
    input.connection.getMinimumBalanceForRentExemption(UPGRADEABLE_LOADER_PROGRAM_SIZE),
  ]);

  const lifetime = {
    blockhash,
    lastValidBlockHeight,
    feePayer: payer,
  };

  const writeChunkSize = calculateMaxWriteChunkSize({
    bufferAccount: bufferKeypair.publicKey,
    upgradeAuthority,
    ...lifetime,
  });

  const bufferInitTransaction = new Transaction({
    ...lifetime,
  }).add(
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: bufferKeypair.publicKey,
      lamports: bufferRent,
      space: sizeOfBuffer(bytecode.length),
      programId: LoaderV3Program.programId,
    }),
    LoaderV3Program.initializeBuffer({
      sourceAccount: bufferKeypair.publicKey,
      bufferAuthority: upgradeAuthority,
    }),
  );
  await bufferInitTransaction.partialSign(bufferKeypair);

  // Multiple Write transactions may be required when the ELF exceeds one packet-sized chunk.
  const writeTransactions: Transaction[] = [];
  for (let offset = 0; offset < bytecode.length; offset += writeChunkSize) {
    const bytes = bytecode.subarray(offset, offset + writeChunkSize);
    writeTransactions.push(
      new Transaction({
        ...lifetime,
      }).add(
        LoaderV3Program.write({
          bufferAccount: bufferKeypair.publicKey,
          bufferAuthority: upgradeAuthority,
          offset,
          bytes,
        }),
      ),
    );
  }

  const deployTransaction = new Transaction({
    ...lifetime,
  }).add(
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: programAddress,
      lamports: programRent,
      space: UPGRADEABLE_LOADER_PROGRAM_SIZE,
      programId: LoaderV3Program.programId,
    }),
    LoaderV3Program.deployWithMaxDataLen({
      payerAccount: payer,
      programDataAccount: programDataAddress,
      programAccount: programAddress,
      bufferAccount: bufferKeypair.publicKey,
      authority: upgradeAuthority,
      maxDataLen,
    }),
  );

  const transactions = [bufferInitTransaction, ...writeTransactions, deployTransaction];

  return {
    transactions,
    programId: programAddress.toBase58(),
    programDataAddress: programDataAddress.toBase58(),
    maxDataLen,
  };
}

async function resolveBytecode(input: BuildDopplerDeployTransactionsInput): Promise<Uint8Array> {
  if ("bytecode" in input) {
    return input.bytecode;
  }

  if ("config" in input) {
    return compileDopplerBytecode(input.config);
  }

  const config = await loadGeneratorConfig(input.schemaFile, input.overrides ?? {});
  return compileDopplerBytecode(config);
}

function sizeOfBuffer(programLen: number): number {
  return UPGRADEABLE_LOADER_BUFFER_METADATA_SIZE + programLen;
}

/** Matches `solana program deploy`: measure an empty Write tx, then reserve 1 byte for shortvec growth. */
function calculateMaxWriteChunkSize(params: {
  bufferAccount: Address;
  upgradeAuthority: Address;
  blockhash: Blockhash;
  lastValidBlockHeight: number | bigint;
  feePayer: Address;
}): number {
  const baseline = new Transaction({
    blockhash: params.blockhash,
    lastValidBlockHeight: params.lastValidBlockHeight,
    feePayer: params.feePayer,
  }).add(
    LoaderV3Program.write({
      bufferAccount: params.bufferAccount,
      bufferAuthority: params.upgradeAuthority,
      offset: 0,
      bytes: new Uint8Array(0),
    }),
  );

  const messageBytes = baseline.serializeMessage();
  const numSigners = baseline.compileMessage().header.numRequiredSignatures;
  const txSize = messageBytes.length + numSigners * SIGNATURE_LENGTH_IN_BYTES;

  return PACKET_DATA_SIZE - txSize - 1;
}
