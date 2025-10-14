import type { ReadonlyUint8Array } from "@solana/codecs-core";

/**
 * Raw on-chain oracle layout. Payload encoding/decoding stays generic so consumers can pick their own types.
 */
export interface OracleData<TPayload> {
  readonly sequence: bigint;
  readonly payload: TPayload;
}

/**
 * Serialises an oracle payload alongside its sequence number.
 * Consumers provide their encoder to keep payload typing flexible.
 *
 * @param input.sequence - Monotonic sequence number enforced by Doppler.
 * @param input.payload - Arbitrary struct to store inside the oracle.
 * @param input.encodePayload - Function that converts the payload into bytes.
 */
export function encodeOracleData<TPayload>(input: {
  readonly sequence: bigint | number;
  readonly payload: TPayload;
  readonly encodePayload: (payload: TPayload) => ReadonlyUint8Array;
}): Uint8Array {
  const payloadBytes = input.encodePayload(input.payload);
  return encodeOracleBytes(input.sequence, payloadBytes);
}

/**
 * Deserialises a Doppler oracle account back into typed data.
 * Callers pass the decoding strategy; this keeps the SDK payload-agnostic.
 *
 * @param input.data - Raw account bytes fetched from RPC.
 * @param input.decodePayload - Function that interprets the payload section.
 */
export function decodeOracleData<TPayload>(input: {
  readonly data: ReadonlyUint8Array;
  readonly decodePayload: (bytes: ReadonlyUint8Array) => TPayload;
}): OracleData<TPayload> {
  if (input.data.length < 8) {
    throw new RangeError("Oracle account data must be at least 8 bytes long");
  }

  const view = new DataView(
    input.data.buffer,
    input.data.byteOffset,
    input.data.byteLength
  );
  const sequence = view.getBigUint64(0, true);
  const payload = input.decodePayload(
    input.data.subarray(8, input.data.length)
  );

  return { sequence, payload };
}

/** Computes the byte span occupied by an oracle payload including its sequence prefix. */
export function getOracleStructSpan(payloadLength: number): number {
  return 8 + payloadLength;
}

/**
 * Low-level encoder that writes the Doppler oracle layout directly.
 *
 * @param sequenceInput - Sequence to embed in the first eight bytes.
 * @param payloadBytes - Bytes to copy after the sequence prefix.
 */
export function encodeOracleBytes(
  sequenceInput: bigint | number,
  payloadBytes: ReadonlyUint8Array
): Uint8Array {
  const sequence = BigInt(sequenceInput);
  if (sequence < 0n || sequence > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError("Sequence must fit within an unsigned 64-bit integer");
  }

  const buffer = new Uint8Array(8 + payloadBytes.length);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setBigUint64(0, sequence, true);
  buffer.set(payloadBytes, 8);
  return buffer;
}
