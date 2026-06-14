import { createCodec, type FixedSizeCodec } from "@solana/codecs";

import type { PayloadSerializer } from "./types";

/** Bridges a {@link PayloadSerializer} to a fixed-size Solana codec. */
export function payloadCodecFromSerializer<T>(serializer: PayloadSerializer<T>): FixedSizeCodec<T> {
  const size = serializer.size();
  return createCodec<T>({
    fixedSize: size,
    read(bytes, offset) {
      const value = serializer.deserialize(bytes.subarray(offset, offset + size));
      return [value, offset + size];
    },
    write(value, bytes, offset) {
      bytes.set(serializer.serialize(value), offset);
      return offset + size;
    },
  });
}
