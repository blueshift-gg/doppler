import { getStructCodec, getU64Codec } from "@solana/codecs";

import type { PayloadSerializer } from "./types";

const u64Codec = getU64Codec();
const priceFeedCodec = getStructCodec([["price", getU64Codec()]]);

/** Built-in serializer for u64 payloads (price feeds). */
export class U64Serializer implements PayloadSerializer<bigint> {
  serialize(payload: bigint): Uint8Array {
    return new Uint8Array(u64Codec.encode(payload));
  }

  deserialize(buffer: Uint8Array): bigint {
    return u64Codec.decode(buffer);
  }

  size(): number {
    return u64Codec.fixedSize;
  }
}

/** Price feed payload matching the on-chain `PriceFeed` struct. */
export interface PriceFeed {
  price: bigint;
}

/** Serializer for `PriceFeed` payloads. */
export class PriceFeedSerializer implements PayloadSerializer<PriceFeed> {
  serialize(payload: PriceFeed): Uint8Array {
    return new Uint8Array(priceFeedCodec.encode(payload));
  }

  deserialize(buffer: Uint8Array): PriceFeed {
    return priceFeedCodec.decode(buffer);
  }

  size(): number {
    return priceFeedCodec.fixedSize;
  }
}
