import { renderAssembly } from "./assembly.js";
import { compileAssemblyToBytecode } from "./bytecode.js";
import type { GeneratorConfig } from "./config.js";

export type GeneratedManifest = {
  name: string;
  programId: string;
  admin: string;
  arch: string;
  payloadSize: number;
  schemaHash: string;
  elfSha256: string;
};

export type DopplerArtifacts = {
  assembly: string;
  bytecode: Uint8Array;
  manifest: GeneratedManifest;
};

/**
 * Build Doppler program artifacts in memory from a generator config.
 *
 * Renders assembly source, compiles it to SBPF bytecode, and produces a
 * manifest with schema and ELF checksums.
 */
export async function createDopplerArtifacts(config: GeneratorConfig): Promise<DopplerArtifacts> {
  const assembly = renderAssembly({
    admin: config.admin,
    payloadSize: config.layout.payloadSize,
  });
  const bytecode = await compileAssemblyToBytecode({
    assemblySource: assembly,
    arch: config.arch,
  });

  const manifest: GeneratedManifest = {
    name: config.name,
    programId: config.programId,
    admin: config.admin,
    arch: config.arch,
    payloadSize: config.layout.payloadSize,
    schemaHash: `sha256:${await sha256(JSON.stringify(config.layout.fields))}`,
    elfSha256: `sha256:${await sha256(bytecode)}`,
  };

  return { assembly, bytecode, manifest };
}

async function sha256(content: string | Uint8Array): Promise<string> {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", digestInput);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
