import { assemble as sbpfAssemble } from "@blueshift-gg/sbpf-assembler/node";

import { SBPF_ASSEMBLER_VERSIONS, type SbpfArch } from "./config.js";

/**
 * Assemble SBPF assembly source into an ELF binary.
 */
export async function assemble({
  source,
  arch,
}: {
  source: string;
  arch: SbpfArch;
}): Promise<Uint8Array> {
  return sbpfAssemble(source, SBPF_ASSEMBLER_VERSIONS[arch]);
}
