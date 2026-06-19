import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolvePackageRoot();

function resolvePackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));

  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "templates", "typescript", "core", "src", "oracle.ts"))) {
      return dir;
    }

    const packageJsonPath = join(dir, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        name?: string;
      };
      if (packageJson.name === "@blueshift-gg/doppler") {
        return dir;
      }
    }

    dir = dirname(dir);
  }

  throw new Error("Could not locate @blueshift-gg/doppler package root");
}

export function templatePath(...segments: string[]): string {
  return join(PACKAGE_ROOT, "templates", ...segments);
}

export async function readTemplate(...segments: string[]): Promise<string> {
  return readFile(templatePath(...segments), "utf8");
}

export function substituteCommonImport(source: string, commonPackageName: string): string {
  return source.replaceAll("@blueshift-gg/doppler-common", commonPackageName);
}
