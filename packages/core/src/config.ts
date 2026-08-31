import type { PayloadSchema } from "@blueshift-gg/doppler-codec";

import { computePayloadLayout } from "./layout.js";
import type { PayloadLayout } from "./layout.js";

/**
 * Supported sBPF arch versions.
 * Reference: https://github.com/blueshift-gg/sbpf/blob/0223df0e7ba622d4956b4ecf3cf2397f6945b76b/crates/assembler/src/lib.rs#L44
 */
export const SBPF_ARCH_VERSIONS = ["v0", "v3"] as const;

/** Public sBPF arch identifiers, derived from {@link SBPF_ARCH_VERSIONS}. */
export type SbpfArch = (typeof SBPF_ARCH_VERSIONS)[number];

/**
 * Numeric SBPF assembler version for each arch.
 * Reference: https://github.com/blueshift-gg/sbpf/blob/0223df0e7ba622d4956b4ecf3cf2397f6945b76b/crates/assembler/src/lib.rs#L55
 */
export const SBPF_ASSEMBLER_VERSIONS: Record<SbpfArch, number> = {
  v0: 0,
  v3: 3,
};

export const DEFAULT_SBPF_ARCH: SbpfArch = "v3";

/** Type guard for {@link SbpfArch}, derived from {@link SBPF_ARCH_VERSIONS}. */
export function isSbpfArch(value: unknown): value is SbpfArch {
  return typeof value === "string" && SBPF_ARCH_VERSIONS.includes(value as SbpfArch);
}

export type GeneratorConfigInput = {
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

export type GeneratorConfig = {
  name: string;
  packageName: string;
  programId: string;
  admin: string;
  arch: SbpfArch;
  layout: PayloadLayout;
};

/**
 * Merge loaded config input with optional overrides and derive layout metadata.
 *
 * Validates required fields, normalizes the payload schema, and computes account
 * layout offsets used by binary generation and SDK generation.
 */
export function createGeneratorConfig(
  loaded: GeneratorConfigInput,
  overrides: ConfigOverrides = {},
): GeneratorConfig {
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

  const arch = input.arch ?? DEFAULT_SBPF_ARCH;
  if (!isSbpfArch(arch)) {
    throw new Error(
      `Invalid arch '${String(arch)}'. Expected one of: ${SBPF_ARCH_VERSIONS.join(", ")}`,
    );
  }

  const layout = computePayloadLayout(input.payload);

  return {
    name,
    packageName: normalizePackageName(name),
    programId,
    admin,
    arch,
    layout,
  };
}

/** Convert a display name into a lowercase kebab-case npm package name. */
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
