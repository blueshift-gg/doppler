import type { GeneratorConfig } from "../config.js";
import type { LayoutField } from "../layout.js";
import { decodeSolanaPublicKey } from "../public-key.js";
import type { ScalarType } from "../schema.js";
import { readTemplate } from "./templates.js";

export type RustSdkFiles = Record<string, string>;

export async function renderRustSdk(config: GeneratorConfig): Promise<RustSdkFiles> {
  const typeName = toPascalCase(config.name);
  const [accounts, transaction] = await Promise.all([
    readTemplate("rust", "src", "accounts.rs"),
    readTemplate("rust", "src", "transaction.rs"),
  ]);

  return {
    "Cargo.toml": renderCargoToml(config.packageName),
    "src/lib.rs": renderRustLib(config, typeName),
    "src/accounts.rs": accounts,
    "src/constants.rs": renderRustConstants(config.programId),
    "src/transaction.rs": transaction,
  };
}

function renderCargoToml(packageName: string): string {
  return [
    "[package]",
    `name = "${packageName}-sdk"`,
    'version = "0.1.0"',
    'edition = "2021"',
    "",
    "[dependencies]",
    'solana-compute-budget-interface = "2.2.2"',
    'solana-hash = "2.3.0"',
    'solana-instruction = "2.3.0"',
    'solana-keypair = "2.3.0"',
    'solana-pubkey = "2.3.0"',
    'solana-signer = "2.2.1"',
    'solana-transaction = { version = "2.3.0", features = ["bincode"] }',
    "",
  ].join("\n");
}

function renderRustLib(config: GeneratorConfig, typeName: string): string {
  return [
    "mod accounts;",
    "mod constants;",
    "pub mod transaction;",
    "",
    `pub use accounts::{Oracle, UpdateInstruction};`,
    "pub use constants::ID;",
    "",
    "#[repr(C)]",
    "#[derive(Clone, Copy, Debug, PartialEq, Eq)]",
    `pub struct ${typeName}Payload {`,
    ...config.layout.fields.map((field) => `    pub ${field.name}: ${rustFieldType(field)},`),
    "}",
    "",
    `impl ${typeName}Payload {`,
    "    #[must_use]",
    "    pub fn to_bytes(&self) -> [u8; PAYLOAD_SIZE] {",
    "        let mut bytes = [0u8; PAYLOAD_SIZE];",
    ...config.layout.fields.flatMap(renderRustWriteField),
    "        bytes",
    "    }",
    "",
    "    #[must_use]",
    "    pub fn from_bytes(bytes: &[u8; PAYLOAD_SIZE]) -> Self {",
    "        Self {",
    ...config.layout.fields.map(renderRustReadField),
    "        }",
    "    }",
    "}",
    "",
    `pub const PAYLOAD_SIZE: usize = ${config.layout.payloadSize};`,
    `pub const PROGRAM_ID: &str = ${JSON.stringify(config.programId)};`,
    `pub const ADMIN: &str = ${JSON.stringify(config.admin)};`,
    "",
  ].join("\n");
}

function renderRustConstants(programId: string): string {
  const bytes = decodeSolanaPublicKey(programId);
  const formattedBytes = formatRustByteArray(bytes);

  return [
    "use solana_pubkey::Pubkey;",
    "",
    `// ${programId}`,
    "pub const ID: Pubkey = Pubkey::new_from_array([",
    formattedBytes,
    "]);",
    "",
    "pub(crate) const SEQUENCE_CHECK_CU: u32 = 5;",
    "pub(crate) const ADMIN_VERIFICATION_CU: u32 = 6;",
    "pub(crate) const PAYLOAD_WRITE_CU: u32 = 6;",
    "",
    "pub(crate) const COMPUTE_BUDGET_IX_CU: u32 = 150;",
    "pub(crate) const COMPUTE_BUDGET_UNIT_PRICE_SIZE: u32 = 9;",
    "pub(crate) const COMPUTE_BUDGET_UNIT_LIMIT_SIZE: u32 = 5;",
    "pub(crate) const COMPUTE_BUDGET_DATA_LIMIT_SIZE: u32 = 5;",
    "pub(crate) const COMPUTE_BUDGET_PROGRAM_SIZE: u32 = 22;",
    "pub(crate) const ORACLE_PROGRAM_SIZE: u32 = 36;",
    "",
  ].join("\n");
}

function formatRustByteArray(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let index = 0; index < bytes.length; index += 8) {
    const chunk = [...bytes.subarray(index, index + 8)].map(
      (byte) => `0x${byte.toString(16).padStart(2, "0")}`,
    );
    const suffix = index + 8 < bytes.length ? "," : "";
    lines.push(`    ${chunk.join(", ")}${suffix}`);
  }
  return lines.join("\n");
}

function rustFieldType(field: LayoutField): string {
  const scalar = rustScalarType(field.type);
  return field.length === 1 ? scalar : `[${scalar}; ${field.length}]`;
}

function rustScalarType(type: ScalarType): string {
  switch (type) {
    case "u8":
    case "u16":
    case "u32":
    case "u64":
    case "i8":
    case "i16":
    case "i32":
    case "i64":
      return type;
    case "bool":
      return "bool";
  }
}

function renderRustWriteField(field: LayoutField): string[] {
  if (field.length === 1) {
    return renderRustWriteScalar(`self.${field.name}`, field.type, field.offset);
  }

  const lines: string[] = [];
  const scalarSize = field.size / field.length;
  for (let index = 0; index < field.length; index += 1) {
    lines.push(
      ...renderRustWriteScalar(
        `self.${field.name}[${index}]`,
        field.type,
        field.offset + index * scalarSize,
      ),
    );
  }
  return lines;
}

function renderRustWriteScalar(accessor: string, type: ScalarType, offset: number): string[] {
  const end = offset + scalarSize(type);
  if (type === "u8" || type === "i8") {
    return [`        bytes[${offset}] = ${accessor} as u8;`];
  }
  if (type === "bool") {
    return [`        bytes[${offset}] = u8::from(${accessor});`];
  }
  return [`        bytes[${offset}..${end}].copy_from_slice(&${accessor}.to_le_bytes());`];
}

function renderRustReadField(field: LayoutField): string {
  if (field.length === 1) {
    return `            ${field.name}: ${renderRustReadScalar(field.type, field.offset)},`;
  }

  const scalarSizeValue = field.size / field.length;
  const values = Array.from({ length: field.length }, (_, index) =>
    renderRustReadScalar(field.type, field.offset + index * scalarSizeValue),
  ).join(", ");
  return `            ${field.name}: [${values}],`;
}

function renderRustReadScalar(type: ScalarType, offset: number): string {
  const end = offset + scalarSize(type);
  switch (type) {
    case "u8":
      return `bytes[${offset}]`;
    case "i8":
      return `bytes[${offset}] as i8`;
    case "bool":
      return `bytes[${offset}] != 0`;
    case "u16":
    case "u32":
    case "u64":
    case "i16":
    case "i32":
    case "i64":
      return `${type}::from_le_bytes(bytes[${offset}..${end}].try_into().expect("slice length checked"))`;
  }
}

function scalarSize(type: ScalarType): number {
  switch (type) {
    case "u8":
    case "i8":
    case "bool":
      return 1;
    case "u16":
    case "i16":
      return 2;
    case "u32":
    case "i32":
      return 4;
    case "u64":
    case "i64":
      return 8;
  }
}

function toPascalCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}
