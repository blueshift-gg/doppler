import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  createDopplerArtifacts,
  type GeneratorConfig,
  type GeneratedManifest,
  type PayloadSchema,
} from "@blueshift-gg/doppler";

export type GenerateOptions = {
  binaryFile: string;
  manifestFile?: string;
};

/**
 * Generate Doppler artifacts in memory and write binary and manifest files.
 *
 * Calls `createDopplerArtifacts` from core, then writes outputs to the paths in `options`.
 */
export async function writeDopplerArtifacts(
  config: GeneratorConfig,
  options: GenerateOptions,
): Promise<GeneratedManifest> {
  const artifacts = await createDopplerArtifacts(config);

  await writeFileEnsuringDir(options.binaryFile, artifacts.binary);

  const outputDir = dirname(options.binaryFile);
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

async function writeFileEnsuringDir(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
