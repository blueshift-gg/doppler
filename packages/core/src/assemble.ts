import { assemble as sbpfAssemble } from "@blueshift-gg/sbpf-assembler";

import { SBPF_ASSEMBLER_VERSIONS, type SbpfArch } from "./config.js";

export type SbpfAssemblerInitInput = unknown;
export type SbpfAssemblerInitOutput = unknown;

let initPromise: Promise<SbpfAssemblerInitOutput | void> | undefined;

/**
 * Initialize the browser WASM build of the SBPF assembler.
 *
 * Node builds of `@blueshift-gg/sbpf-assembler` load WASM eagerly, so this is
 * a no-op there. Browser callers may pass a custom WASM URL, Response, bytes,
 * or module when the default asset URL is not suitable.
 */
export async function initSbpfAssembler(
  input?: SbpfAssemblerInitInput,
): Promise<SbpfAssemblerInitOutput | void> {
  initPromise ??= import("@blueshift-gg/sbpf-assembler").then((module) => {
    const init: unknown = module.default;
    if (typeof init !== "function") {
      return undefined;
    }

    const initWebAssembly = init as (input?: SbpfAssemblerInitInput) => Promise<unknown>;
    return input === undefined ? initWebAssembly() : initWebAssembly(input);
  });

  return initPromise;
}

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
  await initSbpfAssembler();
  return sbpfAssemble(source, SBPF_ASSEMBLER_VERSIONS[arch]);
}
