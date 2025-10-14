import type { Address } from "@solana/addresses";
import { AccountRole, type AccountMeta, type Instruction } from "@solana/instructions";
import type { ReadonlyUint8Array } from "@solana/codecs-core";
import type {
  AccountSignerMeta,
  InstructionWithSigners,
  KeyPairSigner,
} from "@solana/signers";

import {
  ADMIN_VERIFICATION_CU,
  DOPPLER_PROGRAM_ADDRESS,
  PAYLOAD_WRITE_CU,
  SEQUENCE_CHECK_CU,
} from "./constants.ts";
import { encodeOracleBytes, getOracleStructSpan } from "./oracle.ts";

/**
 * Fully typed Doppler update instruction.
 */
export type OracleUpdateInstruction = Instruction<
  typeof DOPPLER_PROGRAM_ADDRESS
> &
  InstructionWithSigners;

/**
 * Creates a Doppler oracle update instruction for the given payload.
 *
 * @param input.admin - Admin address or signer authorised to mutate the oracle.
 * @param input.oracleAddress - Oracle account that should store the payload.
 * @param input.payload - Struct or primitive to serialise into the oracle.
 * @param input.sequence - Monotonic sequence number expected by Doppler.
 * @param input.encodePayload - Encoder that turns the payload into raw bytes.
 * @returns The instruction along with its compute-unit cost and data footprint.
 */
export function createOracleUpdateInstruction<TPayload>(input: {
  readonly admin: Address<string> | KeyPairSigner;
  readonly oracleAddress: Address<string>;
  readonly payload: TPayload;
  readonly sequence: bigint | number;
  readonly encodePayload: (payload: TPayload) => ReadonlyUint8Array;
}): {
  readonly instruction: OracleUpdateInstruction;
  readonly computeUnits: number;
  readonly oracleDataSize: number;
} {
  const adminAccount = getAdminAccountMeta(input.admin);
  const payloadBytes = input.encodePayload(input.payload);
  const encoded = encodeOracleBytes(input.sequence, payloadBytes);
  const oracleDataSize = getOracleStructSpan(payloadBytes.length);
  const computeUnits =
    SEQUENCE_CHECK_CU +
    ADMIN_VERIFICATION_CU +
    PAYLOAD_WRITE_CU +
    Math.floor(oracleDataSize / 4);

  return {
    instruction: {
      programAddress: DOPPLER_PROGRAM_ADDRESS,
      accounts: [
        adminAccount,
        { address: input.oracleAddress, role: AccountRole.WRITABLE },
      ],
      data: encoded,
    },
    computeUnits,
    oracleDataSize,
  };
}

/**
 * Normalises an admin value into an `AccountMeta`, preserving signer metadata when available.
 *
 * @param admin - Either a plain admin address or a `KeyPairSigner` instance.
 * @returns Account metadata compatible with `Instruction.accounts`.
 */
function getAdminAccountMeta(
  admin: Address<string> | KeyPairSigner
): AccountMeta | AccountSignerMeta {
  if (typeof admin === "object" && admin !== null && "address" in admin) {
    const signer = admin as KeyPairSigner;
    return {
      address: signer.address,
      role: AccountRole.READONLY_SIGNER,
      signer,
    } satisfies AccountSignerMeta;
  }

  return { address: admin, role: AccountRole.READONLY_SIGNER };
}
