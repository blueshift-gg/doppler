import { expect, test } from "bun:test";

import { buildPayloadCodec, computePayloadLayout } from "../src/index.js";

test("buildPayloadCodec round-trips scalar payload fields", () => {
  const codec = buildPayloadCodec({
    price: "u64",
    confidence: "u32",
    active: "bool",
  });

  const encoded = codec.encode({ price: 42_000_000n, confidence: 125, active: true });

  expect(codec.decode(encoded)).toEqual({ price: 42_000_000n, confidence: 125, active: true });
});

test("buildPayloadCodec matches the computed payload layout size", () => {
  const schema = {
    price: "u64",
    confidence: "u32",
    twap: { type: "i64", length: 3 },
  } as const;

  const codec = buildPayloadCodec(schema);

  expect(codec.fixedSize).toBe(computePayloadLayout(schema).payloadSize);
});

test("buildPayloadCodec round-trips fixed-size array fields", () => {
  const codec = buildPayloadCodec({ samples: { type: "u16", length: 3 } });

  const encoded = codec.encode({ samples: [7, 11, 13] });

  expect(codec.decode(encoded)).toEqual({ samples: [7, 11, 13] });
});
