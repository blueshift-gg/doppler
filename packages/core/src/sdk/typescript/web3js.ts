import type { GeneratorConfig } from "../../config.js";
import { readTemplate, substituteCommonImport } from "../templates.js";
import {
  commonPackageName,
  renderRolldownConfig,
  renderTsConfig,
  type TypeScriptSdkFiles,
} from "./core.js";

export function web3jsPackageName(packageName: string): string {
  return `${packageName}-web3js`;
}

export async function renderWeb3jsSdk(config: GeneratorConfig): Promise<TypeScriptSdkFiles> {
  const coreName = commonPackageName(config.packageName);
  const packageName = web3jsPackageName(config.packageName);
  const templateFiles = [
    "doppler.ts",
    "index.ts",
    "subscribe.ts",
    "transaction-builder.ts",
    "types.ts",
  ] as const;

  const templates = await Promise.all(
    templateFiles.map((file) => readTemplate("typescript", "web3js", "src", file)),
  );

  const files: TypeScriptSdkFiles = {
    "package.json": renderWeb3jsPackageJson(packageName, coreName),
    "tsconfig.json": renderTsConfig(),
    "rolldown.config.ts": renderRolldownConfig([/^@solana\//, "@solana/web3.js"]),
  };

  for (const [index, file] of templateFiles.entries()) {
    files[`src/${file}`] = substituteCommonImport(templates[index]!, coreName);
  }

  return files;
}

function renderWeb3jsPackageJson(packageName: string, coreName: string): string {
  return `${JSON.stringify(
    {
      name: packageName,
      version: "0.1.0",
      description: "Generated Doppler oracle SDK for @solana/web3.js",
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
        [coreName]: "file:../common",
      },
      devDependencies: {
        "@solana/web3.js": "3.0.0-rc.1",
        typescript: "6.0.3",
      },
      peerDependencies: {
        "@solana/web3.js": "^3.0.0",
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
