import { expect, test } from "bun:test";

import { computePayloadLayout } from "../src/layout.js";

test("computes packed scalar layout", () => {
  expect(computePayloadLayout({ price: "u64" })).toEqual({
    fields: [{ name: "price", type: "u64", length: 1, offset: 0, size: 8 }],
    payloadSize: 8,
  });
});

test("computes packed mixed layout without padding", () => {
  expect(computePayloadLayout({ price: "u64", confidence: "u32", slot: "u64" })).toEqual({
    fields: [
      { name: "price", type: "u64", length: 1, offset: 0, size: 8 },
      { name: "confidence", type: "u32", length: 1, offset: 8, size: 4 },
      { name: "slot", type: "u64", length: 1, offset: 12, size: 8 },
    ],
    payloadSize: 20,
  });
});

test("computes fixed array layout", () => {
  expect(computePayloadLayout({ flags: { type: "u8", length: 32 } }).payloadSize).toBe(32);
});

test("rejects invalid schema fields", () => {
  expect(() => computePayloadLayout({ "bad-field": "u64" })).toThrow("Invalid payload field name");
  expect(() => computePayloadLayout({ price: "string" })).toThrow("Invalid schema");
  expect(() => computePayloadLayout({ flags: { type: "u8", length: 0 } })).toThrow(
    "positive integer length",
  );
});
