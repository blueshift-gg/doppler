import {
  defineConfig,
  type ExternalOption,
  type RolldownOptions,
} from "rolldown";
import { dts } from "rolldown-plugin-dts";

function isExternalModule(
  id: string,
  parentId: string | undefined,
  isResolved: boolean,
  externalOption: ExternalOption | undefined,
): boolean {
  if (id === "@blueshift-gg/doppler-core") {
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

export function createLibraryConfig(options: {
  input: NonNullable<RolldownOptions["input"]>;
  external?: ExternalOption;
}): RolldownOptions {
  const { input, external: externalOption } = options;

  return defineConfig({
    input,
    plugins: [dts()],
    external(id, parentId, isResolved) {
      return isExternalModule(id, parentId, isResolved, externalOption);
    },
    output: {
      dir: "dist",
      format: "esm",
      entryFileNames: "index.js",
    },
  });
}
