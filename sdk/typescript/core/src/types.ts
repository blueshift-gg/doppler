/** Runtime-agnostic Solana address. */
export type Address = string;

/** Generic oracle account layout: sequence number plus a typed payload. */
export interface Oracle<T> {
  sequence: bigint;
  payload: T;
}

/** Serializes and deserializes custom oracle payload types. */
export interface PayloadSerializer<T> {
  serialize(payload: T): Uint8Array;
  deserialize(buffer: Uint8Array): T;
  size(): number;
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
