import { expect, test } from "bun:test";

import {
  defaultPayloadFormValues,
  formatPayloadForDisplay,
  parsePayloadFormValues,
} from "../src/index.js";

test("defaultPayloadFormValues seeds typed defaults", () => {
  expect(
    defaultPayloadFormValues({
      price: "u64",
      confidence: "u32",
    }),
  ).toEqual({
    price: "0",
    confidence: "0",
  });
});

test("parsePayloadFormValues converts strings to payload types", () => {
  expect(
    parsePayloadFormValues(
      {
        price: "u64",
        confidence: "u32",
        status: "u8",
      },
      {
        price: "42000000",
        confidence: "125",
        status: "1",
      },
    ),
  ).toEqual({
    price: 42_000_000n,
    confidence: 125,
    status: 1,
  });
});

test("payload form helpers handle fixed-size array fields", () => {
  const schema = {
    samples: { type: "u16", length: 3 },
    flags: { type: "u8", length: 2 },
  } as const;

  expect(defaultPayloadFormValues(schema)).toEqual({
    samples: "0,0,0",
    flags: "0,0",
  });
  expect(parsePayloadFormValues(schema, { samples: "7, 11, 13", flags: "1, 0" })).toEqual({
    samples: [7, 11, 13],
    flags: [1, 0],
  });
});

test("formatPayloadForDisplay converts primitive and array payload values", () => {
  expect(formatPayloadForDisplay(42_000_000n)).toBe("42000000");
  expect(formatPayloadForDisplay(125)).toBe("125");
  expect(formatPayloadForDisplay([7, 11, 13])).toBe("7,11,13");
});
