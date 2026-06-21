import { getStructCodec, getU64Codec, type FixedSizeCodec } from "@solana/codecs";

import {
  ADMIN_VERIFICATION_CU,
  COMPUTE_BUDGET_DATA_LIMIT_SIZE,
  COMPUTE_BUDGET_IX_CU,
  COMPUTE_BUDGET_PROGRAM_SIZE,
  COMPUTE_BUDGET_UNIT_LIMIT_SIZE,
  COMPUTE_BUDGET_UNIT_PRICE_SIZE,
  ORACLE_PROGRAM_SIZE,
  PAYLOAD_WRITE_CU,
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
  return oracleAccountSize(payloadCodec);
}

export type OracleUpdateComputeBudget = Readonly<{
  computeUnits: number;
  loadedAccountDataSize: number;
}>;

export type OracleUpdateComputeBudgetOptions = Readonly<{
  unitPrice?: bigint;
}>;

/** Compute budget limits for one or more oracle update instructions. */
export function oracleUpdateComputeBudget<T>(
  payloadCodec: FixedSizeCodec<T>,
  updateCount: number,
  options: OracleUpdateComputeBudgetOptions = {},
): OracleUpdateComputeBudget {
  let loadedAccountDataSize =
    ORACLE_PROGRAM_SIZE +
    COMPUTE_BUDGET_PROGRAM_SIZE +
    COMPUTE_BUDGET_UNIT_LIMIT_SIZE +
    COMPUTE_BUDGET_DATA_LIMIT_SIZE +
    2;
  let computeUnits = COMPUTE_BUDGET_IX_CU * 2;

  for (let index = 0; index < updateCount; index++) {
    computeUnits += oracleUpdateComputeUnits(payloadCodec);
    loadedAccountDataSize += oracleUpdateLoadedAccountsDataSize(payloadCodec) * 2;
  }

  if (options.unitPrice !== undefined) {
    loadedAccountDataSize += COMPUTE_BUDGET_UNIT_PRICE_SIZE;
    computeUnits += COMPUTE_BUDGET_IX_CU;
  }

  return { computeUnits, loadedAccountDataSize };
}
