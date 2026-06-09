import type { Address, Keypair } from "@solana/web3.js";

/** Configuration for the web3.js Doppler client. */
export interface DopplerWeb3Config {
  programId: Address;
  admin?: Address;
}

/** Shared context for web3.js transaction builders. */
export interface Web3DopplerContext {
  signer: Keypair;
  programId: Address;
  admin: Address;
}
