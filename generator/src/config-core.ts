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

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}
