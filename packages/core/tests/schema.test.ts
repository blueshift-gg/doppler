import { expect, test } from "bun:test";

import { normalizePayloadSchema } from "../src/index.js";

// ── Happy paths ───────────────────────────────────────────────────────────

test("normalizes scalar shorthand", () => {
  expect(normalizePayloadSchema({ price: "u64" })).toEqual([
    { name: "price", type: "u64", length: 1 },
  ]);
});

test("normalizes array descriptor", () => {
  expect(normalizePayloadSchema({ flags: { type: "u8", length: 32 } })).toEqual([
    { name: "flags", type: "u8", length: 32 },
  ]);
});

test("normalizes mixed scalar and array fields", () => {
  expect(
    normalizePayloadSchema({
      price: "u64",
      flags: { type: "u8", length: 10 },
    }),
  ).toEqual([
    { name: "price", type: "u64", length: 1 },
    { name: "flags", type: "u8", length: 10 },
  ]);
});

// ── Top-level schema errors ───────────────────────────────────────────────

test("rejects non-object schema", () => {
  expect(() => normalizePayloadSchema(null)).toThrow("Payload schema must be an object");
  expect(() => normalizePayloadSchema([])).toThrow("Payload schema must be an object");
  expect(() => normalizePayloadSchema("u64")).toThrow("Payload schema must be an object");
});

test("rejects empty schema", () => {
  expect(() => normalizePayloadSchema({})).toThrow(
    "Payload schema must contain at least one field",
  );
});

// ── Field name errors ─────────────────────────────────────────────────────

test("rejects invalid field name", () => {
  expect(() => normalizePayloadSchema({ "bad-field": "u64" })).toThrow(
    "Invalid payload field name",
  );
});

// ── Field shape errors ────────────────────────────────────────────────────

test("rejects field that is neither string nor record", () => {
  expect(() => normalizePayloadSchema({ price: null })).toThrow("Invalid schema for field");
  expect(() => normalizePayloadSchema({ price: [] })).toThrow("Invalid schema for field");
  expect(() => normalizePayloadSchema({ price: 42 })).toThrow("Invalid schema for field");
  expect(() => normalizePayloadSchema({ price: true })).toThrow("Invalid schema for field");
});

// ── Scalar type errors ────────────────────────────────────────────────────

test("rejects invalid scalar type in shorthand", () => {
  expect(() => normalizePayloadSchema({ price: "string" })).toThrow("Invalid scalar type");
});

test("rejects invalid scalar type in array descriptor", () => {
  expect(() => normalizePayloadSchema({ price: { type: "f32", length: 10 } })).toThrow(
    "Invalid scalar type",
  );
});

test("rejects non-string type in array descriptor", () => {
  expect(() => normalizePayloadSchema({ price: { type: 42, length: 10 } })).toThrow(
    "Invalid scalar type",
  );
});

// ── Array length errors ───────────────────────────────────────────────────

test("rejects zero length", () => {
  expect(() => normalizePayloadSchema({ price: { type: "u64", length: 0 } })).toThrow(
    "length must be a positive integer",
  );
});

test("rejects negative length", () => {
  expect(() => normalizePayloadSchema({ price: { type: "u64", length: -1 } })).toThrow(
    "length must be a positive integer",
  );
});

test("rejects non-integer length", () => {
  expect(() => normalizePayloadSchema({ price: { type: "u64", length: 1.5 } })).toThrow(
    "length must be a positive integer",
  );
});

test("rejects non-number length", () => {
  expect(() => normalizePayloadSchema({ price: { type: "u64", length: "abc" } })).toThrow(
    "length must be a positive integer",
  );
});
