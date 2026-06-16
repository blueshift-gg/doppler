import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  createDopplerArtifacts,
  type GeneratorConfig,
  type GeneratedManifest,
  type PayloadSchema,
  renderCoreSdk,
  renderKitSdk,
  renderRustSdk,
  renderTypeScriptWorkspaceFiles,
  renderWeb3jsSdk,
} from "@blueshift-gg/doppler-core";

export type GenerateOptions = {
  bytecodeFile: string;
  manifestFile?: string;
  assemblyFile?: string;
  web3jsSdkDir?: string;
  kitSdkDir?: string;
  rustSdkDir?: string;
};

/**
 * Generate Doppler artifacts in memory and write bytecode, manifest, assembly, and SDK files.
 *
 * Calls `createDopplerArtifacts` from core, then writes outputs to the paths in `options`.
 */
export async function writeDopplerArtifacts(
  config: GeneratorConfig,
  options: GenerateOptions,
): Promise<GeneratedManifest> {
  const artifacts = await createDopplerArtifacts(config);

  await writeFileEnsuringDir(options.bytecodeFile, artifacts.bytecode);

  if (options.assemblyFile) {
    await writeFileEnsuringDir(options.assemblyFile, artifacts.assembly);
  }

  const typescriptSdkDir = options.web3jsSdkDir ?? options.kitSdkDir;
  if (typescriptSdkDir) {
    const workspaceDir = dirname(typescriptSdkDir);
    const workspaces = [
      "common",
      ...(options.web3jsSdkDir ? [basename(options.web3jsSdkDir)] : []),
      ...(options.kitSdkDir ? [basename(options.kitSdkDir)] : []),
    ];
    await writeFiles(workspaceDir, renderTypeScriptWorkspaceFiles(workspaces));
    await writeFiles(join(workspaceDir, "common"), await renderCoreSdk(config));
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

  const outputDir = dirname(options.bytecodeFile);
  const manifestFile = options.manifestFile ?? join(outputDir, "manifest.json");
  await writeFileEnsuringDir(manifestFile, `${JSON.stringify(artifacts.manifest, null, 2)}\n`);

  return artifacts.manifest;
}

/** Render a TypeScript schema module that exports a default payload definition. */
export function renderInitSchemaFile(payload: PayloadSchema): string {
  const fields = formatPayloadFields(payload, 4);
  return `export default {
  payload: {
${fields},
  },
} as const;
`;
}

function formatPayloadFields(payload: PayloadSchema, indent: number): string {
  const pad = " ".repeat(indent);
  return Object.entries(payload)
    .map(([name, field]) => {
      if (typeof field === "string") {
        return `${pad}${name}: ${JSON.stringify(field)}`;
      }

      return `${pad}${name}: { type: ${JSON.stringify(field.type)}, length: ${field.length} }`;
    })
    .join(",\n");
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
