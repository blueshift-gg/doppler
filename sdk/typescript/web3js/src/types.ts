import type { FixedSizeCodec } from "@blueshift-gg/doppler-common";
import type { Address } from "@solana/web3.js";

/** Configuration for the Doppler client. */
export interface DopplerConfig<T = unknown> {
  programId: Address;
  admin: Address;
  payloadCodec: FixedSizeCodec<T>;
}
