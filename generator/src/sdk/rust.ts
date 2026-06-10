import type { DopplerGeneratorConfig } from "../config.js";
import type { LayoutField } from "../layout.js";
import type { ScalarType } from "../schema.js";

export type RustSdkFiles = Record<string, string>;

export function renderRustSdk(config: DopplerGeneratorConfig): RustSdkFiles {
  const typeName = toPascalCase(config.name);

  return {
    "Cargo.toml": [
      "[package]",
      `name = "${config.packageName}-sdk"`,
      'version = "0.1.0"',
      'edition = "2021"',
      "",
    ].join("\n"),
    "src/lib.rs": renderRustLib(config, typeName),
  };
}

function renderRustLib(config: DopplerGeneratorConfig, typeName: string): string {
  return [
    `pub const PROGRAM_ID: &str = ${JSON.stringify(config.programId)};`,
    `pub const ADMIN: &str = ${JSON.stringify(config.admin)};`,
    `pub const PAYLOAD_SIZE: usize = ${config.layout.payloadSize};`,
    "",
    "#[derive(Clone, Debug, PartialEq, Eq)]",
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
  ].join("\n");
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
