import { defineConfig, type ExternalOption, type RolldownOptions } from "rolldown";
import { dts } from "rolldown-plugin-dts";

function isExternalModule(
  id: string,
  parentId: string | undefined,
  isResolved: boolean,
  externalOption: ExternalOption | undefined,
): boolean {
  if (id === "@blueshift-gg/doppler-common" || isSolanaCodecModule(id)) {
    return false;
  }

  if (externalOption === undefined) {
    return true;
  }

  if (typeof externalOption === "function") {
    return externalOption(id, parentId, isResolved) ?? false;
  }

  if (typeof externalOption === "string") {
    return id === externalOption;
  }

  if (externalOption instanceof RegExp) {
    return externalOption.test(id);
  }

  return externalOption.some((pattern) =>
    typeof pattern === "string" ? id === pattern : pattern.test(id),
  );
}

function isSolanaCodecModule(id: string): boolean {
  return (
    id === "@solana/codecs" ||
    id.startsWith("@solana/codecs-") ||
    id === "@solana/errors" ||
    id === "@solana/fixed-points" ||
    id === "@solana/options"
  );
}

export function createLibraryConfig(options: {
  input: NonNullable<RolldownOptions["input"]>;
  external?: ExternalOption;
}): RolldownOptions {
  const { input, external: externalOption } = options;
  const inputEntry = typeof input === "string" ? { index: input } : input;

  return defineConfig({
    input: inputEntry,
    plugins: [dts()],
    external(id, parentId, isResolved) {
      return isExternalModule(id, parentId, isResolved, externalOption);
    },
    output: {
      dir: "dist",
      format: "esm",
      entryFileNames: "[name].js",
      cleanDir: true,
    },
    platform: "node",
  });
}
