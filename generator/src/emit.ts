import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { DopplerGeneratorConfig } from "./config.js";
import { renderDopplerAssembly } from "./assembly.js";
import { compileAssemblyToBytecode } from "./bytecode.js";
import { renderRustSdk } from "./sdk/rust.js";
import {
  renderCoreSdk,
  renderKitSdk,
  renderTypeScriptWorkspaceFiles,
  renderWeb3jsSdk,
} from "./sdk/typescript.js";

export type GenerateOptions = {
  bytecodeFile: string;
  manifestFile?: string;
  assemblyFile?: string;
  web3jsSdkDir?: string;
  kitSdkDir?: string;
  rustSdkDir?: string;
};

export type GeneratedManifest = {
  name: string;
  programId: string;
  admin: string;
  arch: string;
  payloadSize: number;
  schemaHash: string;
  elfSha256: string;
};

export async function generateDopplerArtifacts(
  config: DopplerGeneratorConfig,
  options: GenerateOptions,
): Promise<GeneratedManifest> {
  const assembly = renderDopplerAssembly({
    admin: config.admin,
    payloadSize: config.layout.payloadSize,
  });
  const bytecode = compileAssemblyToBytecode(assembly, config.arch);

  await writeFileEnsuringDir(options.bytecodeFile, bytecode);

  if (options.assemblyFile) {
    await writeFileEnsuringDir(options.assemblyFile, assembly);
  }

  const typescriptSdkDir = options.web3jsSdkDir ?? options.kitSdkDir;
  if (typescriptSdkDir) {
    const workspaceDir = dirname(typescriptSdkDir);
    const workspaces = [
      "core",
      ...(options.web3jsSdkDir ? [basename(options.web3jsSdkDir)] : []),
      ...(options.kitSdkDir ? [basename(options.kitSdkDir)] : []),
    ];
    await writeFiles(workspaceDir, renderTypeScriptWorkspaceFiles(workspaces));
    await writeFiles(join(workspaceDir, "core"), await renderCoreSdk(config));
  }

  if (options.web3jsSdkDir) {
    await writeFiles(options.web3jsSdkDir, await renderWeb3jsSdk(config));
  }

  if (options.kitSdkDir) {
    await writeFiles(options.kitSdkDir, await renderKitSdk(config));
  }

  if (options.rustSdkDir) {
    await writeFiles(options.rustSdkDir, await renderRustSdk(config));
  }

  const manifest: GeneratedManifest = {
    name: config.name,
    programId: config.programId,
    admin: config.admin,
    arch: config.arch,
    payloadSize: config.layout.payloadSize,
    schemaHash: `sha256:${sha256(JSON.stringify(config.payload))}`,
    elfSha256: `sha256:${sha256(bytecode)}`,
  };

  const manifestFile = options.manifestFile ?? join(dirname(options.bytecodeFile), "manifest.json");
  await writeFileEnsuringDir(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  return manifest;
}

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(files).map(([file, content]) => writeFileEnsuringDir(join(root, file), content)),
  );
}

async function writeFileEnsuringDir(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function sha256(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}
