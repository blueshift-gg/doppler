import type { DopplerGeneratorConfig } from "../../config.js";
import type { LayoutField, PayloadLayout } from "../../layout.js";
import type { ScalarType } from "../../schema.js";
import { readTemplate } from "../templates.js";

export type TypeScriptSdkFiles = Record<string, string>;

export function corePackageName(packageName: string): string {
  return `${packageName}-core`;
}

export async function renderCoreSdk(config: DopplerGeneratorConfig): Promise<TypeScriptSdkFiles> {
  const typeName = toPascalCase(config.name);
  const payloadTypeName = `${typeName}Payload`;
  const serializerName = `${toCamelCase(config.name)}Serializer`;
  const packageName = corePackageName(config.packageName);

  const [oracle, codecBridge] = await Promise.all([
    readTemplate("typescript", "core", "src", "oracle.ts"),
    readTemplate("typescript", "core", "src", "codec-bridge.ts"),
  ]);

  return {
    "package.json": renderCorePackageJson(packageName),
    "tsconfig.json": renderTsConfig(),
    "rolldown.config.ts": renderRolldownConfig([]),
    "src/types.ts": renderTypes(payloadTypeName, config.layout),
    "src/constants.ts": renderConstants(config),
    "src/serializers.ts": renderSerializers(payloadTypeName, serializerName, config.layout),
    "src/oracle.ts": oracle,
    "src/codec-bridge.ts": codecBridge,
    "src/index.ts": [
      'export * from "./constants";',
      'export * from "./oracle";',
      'export * from "./serializers";',
      'export * from "./types";',
      "",
    ].join("\n"),
  };
}

function renderCorePackageJson(packageName: string): string {
  return `${JSON.stringify(
    {
      name: packageName,
      version: "0.1.0",
      type: "module",
      exports: {
        ".": {
          types: "./src/index.ts",
          import: "./dist/index.js",
        },
      },
      files: ["dist"],
      scripts: {
        build: "rolldown -c rolldown.config.ts",
        typecheck: "tsc -p tsconfig.json --noEmit",
      },
      dependencies: {
        "@solana/codecs": "^6.9.0",
      },
      devDependencies: {
        typescript: "6.0.3",
      },
    },
    null,
    2,
  )}\n`;
}

export function renderTsConfig(): string {
  return `${JSON.stringify(
    {
      extends: "../tsconfig.base.json",
      compilerOptions: {
        rootDir: "src",
      },
      include: ["src/**/*.ts"],
    },
    null,
    2,
  )}\n`;
}

export function renderRolldownConfig(external: Array<string | RegExp>): string {
  const externalLiteral =
    external.length === 0
      ? "[]"
      : `[${external
          .map((entry) => (entry instanceof RegExp ? entry.toString() : JSON.stringify(entry)))
          .join(", ")}]`;

  return [
    'import { createLibraryConfig } from "../rolldown.shared";',
    "",
    "export default createLibraryConfig({",
    '  input: "./src/index.ts",',
    `  external: ${externalLiteral},`,
    "});",
    "",
  ].join("\n");
}

export function renderTypeScriptWorkspaceFiles(workspaces: string[]): TypeScriptSdkFiles {
  return {
    "package.json": `${JSON.stringify(
      {
        private: true,
        workspaces,
        devDependencies: {
          rolldown: "1.1.0",
          "rolldown-plugin-dts": "0.25.2",
          typescript: "6.0.3",
        },
        packageManager: "bun@1.3.14",
      },
      null,
      2,
    )}\n`,
    "tsconfig.base.json": `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          lib: ["ES2022", "DOM"],
          types: [],
          strict: true,
          skipLibCheck: true,
          declaration: true,
          declarationMap: true,
          isolatedDeclarations: true,
          verbatimModuleSyntax: true,
          noUncheckedIndexedAccess: true,
          exactOptionalPropertyTypes: true,
        },
      },
      null,
      2,
    )}\n`,
    "rolldown.shared.ts": [
      "import {",
      "  defineConfig,",
      "  type ExternalOption,",
      "  type RolldownOptions,",
      '} from "rolldown";',
      'import { dts } from "rolldown-plugin-dts";',
      "",
      "function isExternalModule(",
      "  id: string,",
      "  parentId: string | undefined,",
      "  isResolved: boolean,",
      "  externalOption: ExternalOption | undefined,",
      "): boolean {",
      "  if (id.endsWith('-core')) {",
      "    return false;",
      "  }",
      "",
      "  if (externalOption === undefined) {",
      "    return true;",
      "  }",
      "",
      "  if (typeof externalOption === 'function') {",
      "    return externalOption(id, parentId, isResolved) ?? false;",
      "  }",
      "",
      "  if (typeof externalOption === 'string') {",
      "    return id === externalOption;",
      "  }",
      "",
      "  if (externalOption instanceof RegExp) {",
      "    return externalOption.test(id);",
      "  }",
      "",
      "  return externalOption.some((pattern) =>",
      "    typeof pattern === 'string' ? id === pattern : pattern.test(id),",
      "  );",
      "}",
      "",
      "export function createLibraryConfig(options: {",
      '  input: NonNullable<RolldownOptions["input"]>;',
      "  external?: ExternalOption;",
      "}): RolldownOptions {",
      "  const { input, external: externalOption } = options;",
      "",
      "  return defineConfig({",
      "    input,",
      "    plugins: [dts()],",
      "    external(id, parentId, isResolved) {",
      "      return isExternalModule(id, parentId, isResolved, externalOption);",
      "    },",
      "    output: {",
      '      dir: "dist",',
      '      format: "esm",',
      '      entryFileNames: "index.js",',
      "    },",
      "  });",
      "}",
      "",
    ].join("\n"),
  };
}

function renderTypes(payloadTypeName: string, layout: PayloadLayout): string {
  const genericTypes = [
    "/** Runtime-agnostic Solana address. */",
    "export type Address = string;",
    "",
    "/** Generic oracle account layout: sequence number plus a typed payload. */",
    "export interface Oracle<T> {",
    "  sequence: bigint;",
    "  payload: T;",
    "}",
    "",
    "/** Serializes and deserializes custom oracle payload types. */",
    "export interface PayloadSerializer<T> {",
    "  serialize(payload: T): Uint8Array;",
    "  deserialize(buffer: Uint8Array): T;",
    "  size(): number;",
    "}",
    "",
    "/** Configuration shared by Doppler clients and transaction builders. */",
    "export interface DopplerConfig {",
    "  /** Doppler program address. */",
    "  programId: Address;",
    "  /**",
    "   * Admin address expected by the program. Required if updating oracles is a permissioned action.",
    "   */",
    "  admin?: Address;",
    "}",
    "",
    "/** Shared context passed to transaction builders. */",
    "export interface DopplerContext {",
    "  signer: Address;",
    "  programId: Address;",
    "  admin: Address;",
    "}",
    "",
  ];

  const payloadLines = layout.fields.map((field) => {
    const type = tsFieldType(field);
    return `  ${field.name}: ${type};`;
  });

  return [...genericTypes, `export interface ${payloadTypeName} {`, ...payloadLines, "}", ""].join(
    "\n",
  );
}

function renderConstants(config: DopplerGeneratorConfig): string {
  return [
    "/** Compute units consumed by a sequence check. */",
    "export const SEQUENCE_CHECK_CU = 5;",
    "",
    "/** Compute units consumed by admin verification. */",
    "export const ADMIN_VERIFICATION_CU = 6;",
    "",
    "/** Compute units consumed by writing the payload. */",
    "export const PAYLOAD_WRITE_CU = 6;",
    "",
    "/** Base compute units for a compute-budget instruction. */",
    "export const COMPUTE_BUDGET_IX_CU = 150;",
    "",
    "/** Account data size for a compute-unit-price instruction. */",
    "export const COMPUTE_BUDGET_UNIT_PRICE_SIZE = 9;",
    "",
    "/** Account data size for a compute-unit-limit instruction. */",
    "export const COMPUTE_BUDGET_UNIT_LIMIT_SIZE = 5;",
    "",
    "/** Account data size for a loaded-accounts-data-size-limit instruction. */",
    "export const COMPUTE_BUDGET_DATA_LIMIT_SIZE = 5;",
    "",
    "/** Account data size for the compute-budget program. */",
    "export const COMPUTE_BUDGET_PROGRAM_SIZE = 22;",
    "",
    "/** Account data size for the oracle program. */",
    "export const ORACLE_PROGRAM_SIZE = 36;",
    "",
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

  return [
    `import { ${["getStructCodec", ...codecImports].join(", ")} } from "@solana/codecs";`,
    `import type { PayloadSerializer } from "./types";`,
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
