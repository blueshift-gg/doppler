import { getStructCodec, getU64Codec, type FixedSizeCodec } from "@solana/codecs";

/** Built-in codec for u64 payloads (price feeds). */
export const u64Codec: FixedSizeCodec<bigint> = getU64Codec();

/** Price feed payload matching the on-chain `PriceFeed` struct. */
export interface PriceFeed {
  price: bigint;
}

/** Codec for `PriceFeed` payloads. */
export const priceFeedCodec: FixedSizeCodec<PriceFeed> = getStructCodec([["price", getU64Codec()]]);
