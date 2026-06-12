import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Keypair } from "@solana/web3.js";
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

async function runSolanaCommand(args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const proc = spawn("solana", args, { stdio: ["inherit", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    proc.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    proc.on("error", (error) => {
      reject(new Error(`Failed to run solana CLI: ${error.message}`));
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `solana command failed with exit code ${code}`));
        return;
      }
      resolvePromise();
    });
  });
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

  const programId = await loadProgramIdFromKeypair(programKeypairPath);
  await validateManifest(bytecodePath, options.admin, programId);

  const args = [
    "-C",
    configPath,
    "program",
    "deploy",
    bytecodePath,
    "--program-id",
    programKeypairPath,
    "--url",
    network,
    "--keypair",
    signerKeypairPath,
  ];

  await runSolanaCommand(args);

  return {
    programId,
    admin: options.admin,
    network,
  };
}
