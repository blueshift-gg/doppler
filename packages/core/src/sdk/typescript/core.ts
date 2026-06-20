import type { GeneratorConfig } from "../../config.js";
import type { LayoutField, PayloadLayout } from "../../layout.js";
import type { ScalarType } from "../../schema.js";

export type TypeScriptSdkFiles = Record<string, string>;

export function codecPackageName(packageName: string): string {
  return `${packageName}-codec`;
}

/** @deprecated Use {@link codecPackageName}. */
export function commonPackageName(packageName: string): string {
  return codecPackageName(packageName);
}

export function renderPayloadCodecSdk(config: GeneratorConfig): TypeScriptSdkFiles {
  const typeName = toPascalCase(config.name);
  const payloadTypeName = `${typeName}Payload`;
  const codecName = `${toCamelCase(config.name)}Codec`;
  const packageName = codecPackageName(config.packageName);

  return {
    "package.json": renderCodecPackageJson(packageName),
    "src/codecs.ts": renderCodecsModule(payloadTypeName, codecName, config.layout, typeName),
  };
}

/** @deprecated Use {@link renderPayloadCodecSdk}. */
export function renderCoreSdk(config: GeneratorConfig): TypeScriptSdkFiles {
  return renderPayloadCodecSdk(config);
}

function renderCodecPackageJson(packageName: string): string {
  return `${JSON.stringify(
    {
      name: packageName,
      version: "0.1.0",
      type: "module",
      exports: {
        ".": {
          types: "./src/codecs.ts",
          import: "./src/codecs.ts",
        },
      },
      files: ["src"],
      dependencies: {
        "@solana/codecs": "^6.9.0",
      },
    },
    null,
    2,
  )}\n`;
}

function renderCodecsModule(
  payloadTypeName: string,
  codecName: string,
  layout: PayloadLayout,
  feedName: string,
): string {
  const imports = [...new Set(layout.fields.map((field) => codecFactory(field.type)))].sort();
  const codecEntries = layout.fields
    .map((field) => {
      const codec =
        field.length === 1
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

  const payloadLines = layout.fields.map((field) => {
    const type = tsFieldType(field);
    return `  ${field.name}: ${type};`;
  });

  return [
    `import { ${["getStructCodec", ...codecImports].join(", ")}, type FixedSizeCodec } from "@solana/codecs";`,
    "",
    `/** ${feedName} payload matching the on-chain layout. */`,
    `export interface ${payloadTypeName} {`,
    ...payloadLines,
    "}",
    "",
    `/** Codec for ${feedName} payloads. */`,
    `export const ${codecName}: FixedSizeCodec<${payloadTypeName}> = getStructCodec([`,
    codecEntries,
    "]);",
    "",
  ].join("\n");
}

function tsFieldType(field: LayoutField): string {
  const scalar = field.type === "u64" || field.type === "i64" ? "bigint" : "number";
  return field.length === 1 ? scalar : `${scalar}[]`;
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
