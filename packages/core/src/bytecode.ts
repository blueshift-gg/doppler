import { assemble } from "@blueshift-gg/sbpf-assembler/node";

import { SBPF_ASSEMBLER_VERSIONS, type SbpfArch } from "./config.js";

type CompileAssemblyToBytecode = {
  assemblySource: string;
  arch: SbpfArch;
};

/**
 * Compile an assembly source string to a bytecode Uint8Array.
 */
export async function compileAssemblyToBytecode({
  assemblySource,
  arch,
}: CompileAssemblyToBytecode): Promise<Uint8Array> {
  return assemble(assemblySource, SBPF_ASSEMBLER_VERSIONS[arch]);
}
