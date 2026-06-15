import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createJiti } from "jiti";

export {
  createGeneratorConfig,
  normalizePackageName,
  type ConfigOverrides,
  type DopplerGeneratorConfig,
  type DopplerGeneratorConfigInput,
  type SbpfArch,
} from "./config-core.js";
import { createGeneratorConfig } from "./config-core.js";
import type {
  ConfigOverrides,
  DopplerGeneratorConfig,
  DopplerGeneratorConfigInput,
} from "./config-core.js";

export async function loadGeneratorConfig(
  schemaFile: string,
  overrides: ConfigOverrides = {},
): Promise<DopplerGeneratorConfig> {
  const loaded = await loadGeneratorConfigInput(schemaFile);
  return createGeneratorConfig(loaded, overrides);
}

export async function loadGeneratorConfigInput(
  schemaFile: string,
): Promise<DopplerGeneratorConfigInput> {
  const absolutePath = resolve(schemaFile);
  const extension = extname(absolutePath);

  if (extension === ".json") {
    return JSON.parse(await readFile(absolutePath, "utf8")) as DopplerGeneratorConfigInput;
  }

  if (extension === ".ts" || extension === ".cts" || extension === ".mts") {
    const jiti = createJiti(import.meta.url, { interopDefault: true });
    const config = (await jiti.import(absolutePath, { default: true })) as
      | DopplerGeneratorConfigInput
      | { default?: DopplerGeneratorConfigInput; config?: DopplerGeneratorConfigInput };

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
      default?: DopplerGeneratorConfigInput;
      config?: DopplerGeneratorConfigInput;
    };
    const config = module.default ?? module.config;
    if (!config) {
      throw new Error(`Config file '${schemaFile}' must export a default config object`);
    }
    return config;
  }

  throw new Error(`Unsupported schema file extension '${extension}'`);
}

function isGeneratorConfigInput(value: unknown): value is DopplerGeneratorConfigInput {
  return typeof value === "object" && value !== null && "payload" in value;
}
