import type { DopplerGeneratorConfig } from "../../config.js";
import { readTemplate, substituteCoreImport } from "../templates.js";
import {
  corePackageName,
  renderRolldownConfig,
  renderTsConfig,
  type TypeScriptSdkFiles,
} from "./core.js";

export function kitPackageName(packageName: string): string {
  return `${packageName}-kit`;
}

export async function renderKitSdk(config: DopplerGeneratorConfig): Promise<TypeScriptSdkFiles> {
  const coreName = corePackageName(config.packageName);
  const packageName = kitPackageName(config.packageName);
  const templateFiles = [
    "decode-base64.ts",
    "doppler.ts",
    "index.ts",
    "instructions.ts",
    "transaction-builder.ts",
    "types.ts",
  ] as const;

  const templates = await Promise.all(
    templateFiles.map((file) => readTemplate("typescript", "kit", "src", file)),
  );

  const files: TypeScriptSdkFiles = {
    "package.json": renderKitPackageJson(packageName, coreName),
    "tsconfig.json": renderTsConfig(),
    "rolldown.config.ts": renderRolldownConfig([/^@solana\//, /^@solana-program\//]),
  };

  for (const [index, file] of templateFiles.entries()) {
    files[`src/${file}`] = substituteCoreImport(templates[index]!, coreName);
  }

  return files;
}

function renderKitPackageJson(packageName: string, coreName: string): string {
  return `${JSON.stringify(
    {
      name: packageName,
      version: "0.1.0",
      description: "Generated Doppler oracle SDK for @solana/kit",
      type: "module",
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
        },
      },
      files: ["dist"],
      scripts: {
        build: "rolldown -c rolldown.config.ts",
        typecheck: "tsc -p tsconfig.json --noEmit",
      },
      dependencies: {
        [coreName]: "file:../core",
        "@solana-program/compute-budget": "^0.15.0",
        "@solana-program/system": "^0.12.2",
      },
      devDependencies: {
        "@solana/kit": "^6.9.0",
        typescript: "6.0.3",
      },
      peerDependencies: {
        "@solana-program/compute-budget": "^0.15.0",
        "@solana-program/system": "^0.12.2",
        "@solana/kit": "^6.9.0",
        typescript: "^6",
      },
      peerDependenciesMeta: {
        typescript: {
          optional: true,
        },
      },
    },
    null,
    2,
  )}\n`;
}
