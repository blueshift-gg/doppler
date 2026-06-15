import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createGeneratorConfig } from "@blueshift-gg/doppler-core";
import type {
  ConfigOverrides,
  GeneratorConfig,
  GeneratorConfigInput,
} from "@blueshift-gg/doppler-core";
import { createJiti } from "jiti";

/**
 * Load a generator config from a schema file, merge optional overrides, and normalize it.
 *
 * Reads `manifest.json` from the schema file's directory when present.
 */
export async function loadGeneratorConfig(
  schemaFile: string,
  overrides: ConfigOverrides = {},
): Promise<GeneratorConfig> {
  const loaded = await loadGeneratorConfigInput(schemaFile);
  return createGeneratorConfig(loaded, overrides);
}

/** Load partial generator settings from a schema file and adjacent `manifest.json`. */
export async function loadGeneratorConfigInput(schemaFile: string): Promise<GeneratorConfigInput> {
  const absolutePath = resolve(schemaFile);
  const schemaInput = await loadSchemaFileInput(absolutePath, schemaFile);
  const manifestInput = await loadManifestConfigInput(dirname(absolutePath));
  return { ...manifestInput, ...schemaInput };
}

async function loadSchemaFileInput(
  absolutePath: string,
  schemaFile: string,
): Promise<GeneratorConfigInput> {
  const extension = extname(absolutePath);

  if (extension === ".json") {
    return JSON.parse(await readFile(absolutePath, "utf8")) as GeneratorConfigInput;
  }

  if (extension === ".ts" || extension === ".cts" || extension === ".mts") {
    const jiti = createJiti(import.meta.url, { interopDefault: true });
    const config = (await jiti.import(absolutePath, { default: true })) as
      | GeneratorConfigInput
      | { default?: GeneratorConfigInput; config?: GeneratorConfigInput };

    if (isGeneratorConfigInput(config)) {
      return config;
    }

    const exportedConfig = config.default ?? config.config;
    if (!exportedConfig) {
      throw new Error(`Config file '${schemaFile}' must export a default config object`);
    }
    return exportedConfig;
  }

  if (extension === ".js" || extension === ".mjs") {
    const module = (await import(pathToFileURL(absolutePath).href)) as {
      default?: GeneratorConfigInput;
      config?: GeneratorConfigInput;
    };
    const config = module.default ?? module.config;
    if (!config) {
      throw new Error(`Config file '${schemaFile}' must export a default config object`);
    }
    return config;
  }

  throw new Error(`Unsupported schema file extension '${extension}'`);
}

async function loadManifestConfigInput(directory: string): Promise<GeneratorConfigInput> {
  const manifestPath = join(directory, "manifest.json");

  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    return {
      ...(typeof manifest.name === "string" ? { name: manifest.name } : {}),
      ...(typeof manifest.programId === "string" ? { programId: manifest.programId } : {}),
      ...(typeof manifest.admin === "string" ? { admin: manifest.admin } : {}),
      ...(manifest.arch === "v0" || manifest.arch === "v3" ? { arch: manifest.arch } : {}),
    };
  } catch {
    return {};
  }
}

function isGeneratorConfigInput(value: unknown): value is GeneratorConfigInput {
  return typeof value === "object" && value !== null && "payload" in value;
}
