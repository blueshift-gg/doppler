import init, { assemble } from "@blueshift-gg/sbpf-assembler";

import type { SbpfArch } from "./config.js";

type CompileAssemblyToBytecode = {
  assemblySource: string;
  arch: SbpfArch;
};

// Browser builds of the assembler expose an async WASM initializer; Node builds are already initialized.
const maybeInit = init as unknown;

if (typeof maybeInit === "function") {
  await (maybeInit as () => Promise<unknown>)();
}

/**
 * Compile an assembly source string to a bytecode Uint8Array.
 *
 * Async because browser builds of the assembler expose an async WASM initializer.
 */
export async function compileAssemblyToBytecode({
  assemblySource,
  arch,
}: CompileAssemblyToBytecode): Promise<Uint8Array> {
  return assemble(assemblySource, arch === "v3" ? 3 : 0);
}
