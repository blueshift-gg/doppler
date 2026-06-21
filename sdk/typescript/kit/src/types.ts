import type { Address } from "@solana/kit";

/** Configuration for the Doppler client. */
export interface DopplerConfig {
  programId: Address;
  admin: Address;
}
