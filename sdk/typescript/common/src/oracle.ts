import { getStructCodec, getU64Codec } from "@solana/codecs";

import { payloadCodecFromSerializer } from "./codec-bridge";
import { ADMIN_VERIFICATION_CU, PAYLOAD_WRITE_CU, SEQUENCE_CHECK_CU } from "./constants";
import type { Oracle, PayloadSerializer } from "./types";

function getOracleCodec<T>(serializer: PayloadSerializer<T>) {
  return getStructCodec([
    ["sequence", getU64Codec()],
    ["payload", payloadCodecFromSerializer(serializer)],
  ]);
}

export function serializeOracle<T>(
  oracle: Oracle<T>,
  serializer: PayloadSerializer<T>,
): Uint8Array {
  return new Uint8Array(getOracleCodec(serializer).encode(oracle));
}

export function deserializeOracle<T>(
  data: Uint8Array,
  serializer: PayloadSerializer<T>,
): Oracle<T> {
  const codec = getOracleCodec(serializer);
  if (data.length < codec.fixedSize) {
    throw new Error(
      `Invalid oracle data size. Expected at least ${codec.fixedSize}, got ${data.length}`,
    );
  }

  return codec.decode(data);
}

export function oracleAccountSize<T>(serializer: PayloadSerializer<T>): number {
  return getOracleCodec(serializer).fixedSize;
}

export function oracleUpdateComputeUnits<T>(serializer: PayloadSerializer<T>): number {
  const oracleSize = oracleAccountSize(serializer);
  return SEQUENCE_CHECK_CU + ADMIN_VERIFICATION_CU + PAYLOAD_WRITE_CU + Math.floor(oracleSize / 4);
}

export function oracleUpdateLoadedAccountsDataSize<T>(serializer: PayloadSerializer<T>): number {
  return oracleAccountSize(serializer);
}
