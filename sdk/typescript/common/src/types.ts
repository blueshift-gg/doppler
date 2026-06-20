/** Runtime-agnostic Solana address. */
export type Address = string;

/** Generic oracle account layout: sequence number plus a typed payload. */
export interface Oracle<T> {
  sequence: bigint;
  payload: T;
}

/** Configuration shared by Doppler clients and transaction builders. */
export interface DopplerConfig {
  /** Doppler program address. */
  programId: Address;
  /**
   * Admin address expected by the program. Required if updating oracles is a permissioned action.
   */
  admin?: Address;
}

/** Shared context passed to transaction builders. */
export interface DopplerContext {
  signer: Address;
  programId: Address;
  admin: Address;
}
