import { getStructCodec, getU64Codec, type FixedSizeCodec } from "@solana/codecs";

import {
  ACCOUNT_METADATA_SIZE,
  ADMIN_VERIFICATION_CU,
  COMPUTE_BUDGET_IX_CU,
  COMPUTE_BUDGET_PROGRAM_SIZE,
  ELF_HEADER_SIZE,
  PAYLOAD_WRITE_CU,
  PROGRAM_ACCOUNT_SIZE,
  SEQUENCE_CHECK_CU,
} from "./constants";
import type { Oracle } from "./types";

function getOracleCodec<T>(payloadCodec: FixedSizeCodec<T>) {
  return getStructCodec([
    ["sequence", getU64Codec()],
    ["payload", payloadCodec],
  ]);
}

export function serializeOracle<T>(oracle: Oracle<T>, payloadCodec: FixedSizeCodec<T>): Uint8Array {
  return new Uint8Array(getOracleCodec(payloadCodec).encode(oracle));
}

export function deserializeOracle<T>(data: Uint8Array, payloadCodec: FixedSizeCodec<T>): Oracle<T> {
  const codec = getOracleCodec(payloadCodec);
  if (data.length < codec.fixedSize) {
    throw new Error(
      `Invalid oracle data size. Expected at least ${codec.fixedSize}, got ${data.length}`,
    );
  }

  return codec.decode(data);
}

export function oracleAccountSize<T>(payloadCodec: FixedSizeCodec<T>): number {
  return getOracleCodec(payloadCodec).fixedSize;
}

export function oracleUpdateComputeUnits<T>(payloadCodec: FixedSizeCodec<T>): number {
  const oracleSize = oracleAccountSize(payloadCodec);
  return SEQUENCE_CHECK_CU + ADMIN_VERIFICATION_CU + PAYLOAD_WRITE_CU + Math.floor(oracleSize / 4);
}

export function oracleUpdateLoadedAccountsDataSize<T>(payloadCodec: FixedSizeCodec<T>): number {
  return oracleAccountSize(payloadCodec) + ACCOUNT_METADATA_SIZE;
}

export function baseOracleUpdateLoadedAccountDataSize(programDataAccountSize: number): number {
  return (
    PROGRAM_ACCOUNT_SIZE +
    COMPUTE_BUDGET_PROGRAM_SIZE +
    ELF_HEADER_SIZE +
    programDataAccountSize +
    ACCOUNT_METADATA_SIZE * 4
  );
}

export type OracleUpdateComputeBudget = Readonly<{
  computeUnits: number;
  loadedAccountDataSize: number;
}>;

/** Compute budget limits for one or more oracle update instructions. */
export function oracleUpdateComputeBudget<T>(
  payloadCodec: FixedSizeCodec<T>,
  updateCount: number,
  programDataAccountSize: number,
): OracleUpdateComputeBudget {
  if (!Number.isInteger(updateCount) || updateCount < 0) {
    throw new RangeError("updateCount must be a non-negative integer");
  }

  if (!Number.isInteger(programDataAccountSize) || programDataAccountSize < 0) {
    throw new RangeError("programDataAccountSize must be a non-negative integer");
  }

  let loadedAccountDataSize = baseOracleUpdateLoadedAccountDataSize(programDataAccountSize);
  let computeUnits = COMPUTE_BUDGET_IX_CU * 3;

  for (let index = 0; index < updateCount; index++) {
    computeUnits += oracleUpdateComputeUnits(payloadCodec);
    loadedAccountDataSize += oracleUpdateLoadedAccountsDataSize(payloadCodec);
  }

  return { computeUnits, loadedAccountDataSize };
}
