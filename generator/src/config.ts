import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import { computePayloadLayout } from "./layout.js";
import type { PayloadLayout } from "./layout.js";
import { normalizedSchemaObject, normalizePayloadSchema } from "./schema.js";
import type { PayloadSchema } from "./schema.js";

// https://github.com/blueshift-gg/sbpf/blob/master/crates/assembler/src/lib.rs#L44
export type SbpfArch = "v0" | "v3";

export type DopplerGeneratorConfigInput = {
  name?: string;
  programId?: string;
  admin?: string;
  arch?: SbpfArch;
  payload?: PayloadSchema;
};

export type ConfigOverrides = {
  name?: string;
  programId?: string;
  admin?: string;
  arch?: SbpfArch;
};

export type DopplerGeneratorConfig = {
  name: string;
  packageName: string;
  programId: string;
  admin: string;
  arch: SbpfArch;
  payload: PayloadSchema;
  layout: PayloadLayout;
};

export async function loadGeneratorConfig(
  schemaFile: string,
  overrides: ConfigOverrides = {},
): Promise<DopplerGeneratorConfig> {
  const loaded = await loadGeneratorConfigInput(schemaFile);
  return createGeneratorConfig(loaded, overrides);
}

export function createGeneratorConfig(
  loaded: DopplerGeneratorConfigInput,
  overrides: ConfigOverrides = {},
): DopplerGeneratorConfig {
  const input = { ...loaded, ...withoutUndefined(overrides) };

  if (!input.payload) {
    throw new Error("Generator config requires a payload schema");
  }

  const name = input.name?.trim();
  if (!name) {
    throw new Error("Generator config requires a name");
  }

  const programId = input.programId?.trim();
  if (!programId) {
    throw new Error("Generator config requires a programId");
  }

  const admin = input.admin?.trim();
  if (!admin) {
    throw new Error("Generator config requires an admin address");
  }

  const arch = input.arch ?? "v3";
  if (arch !== "v0" && arch !== "v3") {
    throw new Error(`Invalid arch '${String(arch)}'. Expected 'v0' or 'v3'`);
  }

  const normalizedFields = normalizePayloadSchema(input.payload);
  const payload = normalizedSchemaObject(normalizedFields);
  const layout = computePayloadLayout(payload);

  return {
    name,
    packageName: normalizePackageName(name),
    programId,
    admin,
    arch,
    payload,
    layout,
  };
}

export function normalizePackageName(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
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

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}
