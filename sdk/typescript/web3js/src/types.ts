import type { Address } from "@solana/web3.js";

/** Configuration for the Doppler client. */
export interface DopplerConfig {
  programId: Address;
  admin: Address;
}
