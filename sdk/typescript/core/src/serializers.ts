import type { PayloadSerializer } from "./types";

/** Built-in serializer for u64 payloads (price feeds). */
export class U64Serializer implements PayloadSerializer<bigint> {
  serialize(payload: bigint): Uint8Array {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setBigUint64(0, payload, true);
    return buf;
  }

  deserialize(buffer: Uint8Array): bigint {
    return new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    ).getBigUint64(0, true);
  }

  size(): number {
    return 8;
  }
}

/** Price feed payload matching the on-chain `PriceFeed` struct. */
export interface PriceFeed {
  price: bigint;
}

/** Serializer for `PriceFeed` payloads. */
export class PriceFeedSerializer implements PayloadSerializer<PriceFeed> {
  private readonly inner = new U64Serializer();

  serialize(payload: PriceFeed): Uint8Array {
    return this.inner.serialize(payload.price);
  }

  deserialize(buffer: Uint8Array): PriceFeed {
    return { price: this.inner.deserialize(buffer) };
  }

  size(): number {
    return this.inner.size();
  }
}
