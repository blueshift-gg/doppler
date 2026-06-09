import {
  ADMIN_VERIFICATION_CU,
  PAYLOAD_WRITE_CU,
  SEQUENCE_CHECK_CU,
} from "./constants";
import type { Oracle, PayloadSerializer } from "./types";

export function serializeOracle<T>(
  oracle: Oracle<T>,
  serializer: PayloadSerializer<T>,
): Uint8Array {
  const sequenceBuffer = new Uint8Array(8);
  new DataView(sequenceBuffer.buffer).setBigUint64(0, oracle.sequence, true);

  const payloadBuffer = serializer.serialize(oracle.payload);
  const data = new Uint8Array(sequenceBuffer.length + payloadBuffer.length);
  data.set(sequenceBuffer, 0);
  data.set(payloadBuffer, sequenceBuffer.length);
  return data;
}

export function deserializeOracle<T>(
  data: Uint8Array,
  serializer: PayloadSerializer<T>,
): Oracle<T> {
  const expectedSize = 8 + serializer.size();
  if (data.length < expectedSize) {
    throw new Error(
      `Invalid oracle data size. Expected at least ${expectedSize}, got ${data.length}`,
    );
  }

  const sequence = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  ).getBigUint64(0, true);
  const payloadBuffer = data.subarray(8, 8 + serializer.size());
  const payload = serializer.deserialize(payloadBuffer);

  return { sequence, payload };
}

export function oracleAccountSize<T>(serializer: PayloadSerializer<T>): number {
  return 8 + serializer.size();
}

export function oracleUpdateComputeUnits<T>(
  serializer: PayloadSerializer<T>,
): number {
  const oracleSize = oracleAccountSize(serializer);
  return (
    SEQUENCE_CHECK_CU +
    ADMIN_VERIFICATION_CU +
    PAYLOAD_WRITE_CU +
    Math.floor(oracleSize / 4)
  );
}

export function oracleUpdateLoadedAccountsDataSize<T>(
  serializer: PayloadSerializer<T>,
): number {
  return oracleAccountSize(serializer);
}
