import type { Address, TransactionSigner } from "@solana/kit";

/** Configuration for the Kit Doppler client. */
export interface DopplerKitConfig {
  programId: Address;
  admin?: Address;
}

/** Shared context for Kit transaction builders. */
export interface KitDopplerContext {
  signer: TransactionSigner;
  programId: Address;
  admin: Address;
}
