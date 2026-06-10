import type { DopplerGeneratorConfig } from "../config.js";
import type { LayoutField, PayloadLayout } from "../layout.js";
import type { ScalarType } from "../schema.js";

export type TypeScriptSdkFiles = Record<string, string>;

export function renderTypeScriptSdk(config: DopplerGeneratorConfig): TypeScriptSdkFiles {
  const typeName = toPascalCase(config.name);
  const payloadTypeName = `${typeName}Payload`;
  const serializerName = `${toCamelCase(config.name)}Serializer`;

  return {
    "types.ts": renderTypes(payloadTypeName, config.layout),
    "constants.ts": renderConstants(config),
    "serializers.ts": renderSerializers(payloadTypeName, serializerName, config.layout),
    "index.ts": [
      'export * from "./constants";',
      'export * from "./serializers";',
      'export * from "./types";',
      "",
    ].join("\n"),
  };
}

function renderTypes(payloadTypeName: string, layout: PayloadLayout): string {
  const lines = layout.fields.map((field) => {
    const type = tsFieldType(field);
    return `  ${field.name}: ${type};`;
  });

  return [`export interface ${payloadTypeName} {`, ...lines, "}", ""].join("\n");
}

function renderConstants(config: DopplerGeneratorConfig): string {
  return [
    `export const PROGRAM_ID = ${JSON.stringify(config.programId)};`,
    `export const ADMIN = ${JSON.stringify(config.admin)};`,
    `export const PAYLOAD_SIZE = ${config.layout.payloadSize};`,
    `export const ARCH = ${JSON.stringify(config.arch)};`,
    "",
  ].join("\n");
}

function renderSerializers(
  payloadTypeName: string,
  serializerName: string,
  layout: PayloadLayout,
): string {
  const imports = [...new Set(layout.fields.map((field) => codecImport(field.type)))].sort();
  const codecEntries = layout.fields
    .map((field) => {
      const codec = field.length === 1
        ? `${codecFactory(field.type)}()`
        : `getArrayCodec(${codecFactory(field.type)}(), { size: ${field.length} })`;
      return `  ["${field.name}", ${codec}],`;
    })
    .join("\n");

  const codecImports = imports.includes("getArrayCodec")
    ? imports
    : layout.fields.some((field) => field.length > 1)
      ? [...imports, "getArrayCodec"].sort()
      : imports;

  return [
    `import { ${["getStructCodec", ...codecImports].join(", ")} } from "@solana/codecs";`,
    'import type { PayloadSerializer } from "@blueshift-gg/doppler-core";',
    'import { PAYLOAD_SIZE } from "./constants";',
    `import type { ${payloadTypeName} } from "./types";`,
    "",
    `const payloadCodec = getStructCodec<${payloadTypeName}>([`,
    codecEntries,
    "]);",
    "",
    `export const ${serializerName}: PayloadSerializer<${payloadTypeName}> = {`,
    `  serialize(payload: ${payloadTypeName}): Uint8Array {`,
    "    return new Uint8Array(payloadCodec.encode(payload));",
    "  },",
    "",
    `  deserialize(buffer: Uint8Array): ${payloadTypeName} {`,
    "    return payloadCodec.decode(buffer);",
    "  },",
    "",
    "  size(): number {",
    "    return PAYLOAD_SIZE;",
    "  },",
    "};",
    "",
  ].join("\n");
}

function tsFieldType(field: LayoutField): string {
  const scalar = field.type === "u64" || field.type === "i64" ? "bigint" : "number";
  return field.length === 1 ? scalar : `${scalar}[]`;
}

function codecImport(type: ScalarType): string {
  return codecFactory(type);
}

function codecFactory(type: ScalarType): string {
  switch (type) {
    case "u8":
      return "getU8Codec";
    case "u16":
      return "getU16Codec";
    case "u32":
      return "getU32Codec";
    case "u64":
      return "getU64Codec";
    case "i8":
      return "getI8Codec";
    case "i16":
      return "getI16Codec";
    case "i32":
      return "getI32Codec";
    case "i64":
      return "getI64Codec";
    case "bool":
      return "getBooleanCodec";
  }
}

function toPascalCase(value: string): string {
  return words(value)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

function toCamelCase(value: string): string {
  const pascal = toPascalCase(value);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}
