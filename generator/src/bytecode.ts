import { assemble } from "@blueshift-gg/sbpf-assembler";
import type { SbpfArch } from "./config.js";

export function compileAssemblyToBytecode(
  assemblySource: string,
  arch: SbpfArch = "v3",
): Uint8Array {
  const archNumber = arch === "v3" ? 3 : 0;

  try {
    return assemble(assemblySource, archNumber);
  } catch (error) {
    throw new Error(
      `Failed to assemble Doppler program for arch ${arch}: ${formatAssemblerError(error)}`,
    );
  }
}

function formatAssemblerError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
