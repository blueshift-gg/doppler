import { renderDopplerAssembly } from "./assembly.js";
import { compileAssemblyToBytecode } from "./bytecode.js";
import type { DopplerGeneratorConfig } from "./config-core.js";

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

export async function createDopplerArtifacts(
  config: DopplerGeneratorConfig,
): Promise<DopplerArtifacts> {
  const assembly = renderDopplerAssembly({
    admin: config.admin,
    payloadSize: config.layout.payloadSize,
  });
  const bytecode = compileAssemblyToBytecode(assembly, config.arch);

  const manifest: GeneratedManifest = {
    name: config.name,
    programId: config.programId,
    admin: config.admin,
    arch: config.arch,
    payloadSize: config.layout.payloadSize,
    schemaHash: `sha256:${await sha256(JSON.stringify(config.payload))}`,
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
