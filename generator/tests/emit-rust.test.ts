import { expect, test } from "bun:test";
import { computePayloadLayout } from "../src/layout.js";
import { renderRustSdk } from "../src/sdk/rust.js";
import type { PayloadSchema } from "../src/schema.js";

test("renders Rust SDK without unsafe transmute", () => {
  const payload: PayloadSchema = { price: "u64", confidence: "u32" };
  const files = renderRustSdk({
    name: "SolUsdcFeed",
    packageName: "sol-usdc-feed",
    programId: "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm",
    admin: "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE",
    arch: "v3",
    payload,
    layout: computePayloadLayout(payload),
  });

  expect(files["src/lib.rs"]).toContain("pub struct SolUsdcFeedPayload");
  expect(files["src/lib.rs"]).toContain("copy_from_slice");
  expect(files["src/lib.rs"]).not.toContain("unsafe");
});
