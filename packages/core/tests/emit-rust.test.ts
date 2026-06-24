import { expect, test } from "bun:test";

import { createGeneratorConfig } from "../src/config.js";
import { renderRustSdk } from "../src/sdk/rust.js";

test("renders Rust SDK without unsafe transmute in payload helpers", async () => {
  const config = createGeneratorConfig({
    name: "SolUsdcFeed",
    programId: "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm",
    admin: "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE",
    payload: { price: "u64", confidence: "u32" },
  });
  const files = await renderRustSdk(config);

  expect(files["src/lib.rs"]).toContain("pub struct SolUsdcFeedPayload");
  expect(files["src/lib.rs"]).toContain("impl OraclePayload for SolUsdcFeedPayload");
  expect(files["src/lib.rs"]).toContain("fn to_bytes(&self, bytes: &mut [u8])");
  expect(files["src/lib.rs"]).toContain("copy_from_slice");
  expect(files["src/lib.rs"]).not.toContain("unsafe");
  expect(files["src/accounts.rs"]).toContain("pub struct Oracle");
  expect(files["src/accounts.rs"]).toContain("pub trait OraclePayload");
  expect(files["src/transaction.rs"]).toContain("pub struct Builder");
  expect(files["src/constants.rs"]).toContain("pub const ID: Pubkey");
});
