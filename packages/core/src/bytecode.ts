import type { SbpfArch } from "./config.js";

type CompileAssemblyToBytecode = {
  assemblySource: string;
  arch: SbpfArch;
};

type SbpfAssembler = {
  assemble: (source: string, arch: number) => Uint8Array;
  default?: () => Promise<unknown>;
};

let assemblerPromise: Promise<SbpfAssembler> | undefined;

/**
 * Compile an assembly source string to a bytecode Uint8Array.
 *
 * Async because browser builds of the assembler expose an async WASM initializer.
 */
export async function compileAssemblyToBytecode({
  assemblySource,
  arch,
}: CompileAssemblyToBytecode): Promise<Uint8Array> {
  const { assemble } = await loadAssembler();
  return assemble(assemblySource, arch === "v3" ? 3 : 0);
}

async function loadAssembler(): Promise<SbpfAssembler> {
  assemblerPromise ??= import("@blueshift-gg/sbpf-assembler").then(async (assembler) => {
    const maybeInit = assembler.default as unknown;
    if (typeof maybeInit === "function") {
      await maybeInit();
    }

    return assembler as unknown as SbpfAssembler;
  });

  return assemblerPromise;
}
