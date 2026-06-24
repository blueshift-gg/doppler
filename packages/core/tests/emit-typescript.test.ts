import { expect, test } from "bun:test";

import { createGeneratorConfig } from "../src/config.js";
import { renderPayloadCodecSdk } from "../src/sdk/typescript.js";

test("renders payload codec TypeScript SDK files", () => {
  const config = createGeneratorConfig({
    name: "SolUsdcFeed",
    programId: "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm",
    admin: "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE",
    payload: { price: "u64", confidence: "u32", slot: "u64" },
  });
  const files = renderPayloadCodecSdk(config);

  expect(files["src/codecs.ts"]).toContain("export interface SolUsdcFeedPayload");
  expect(files["src/codecs.ts"]).toContain(
    "export const solUsdcFeedCodec: FixedSizeCodec<SolUsdcFeedPayload>",
  );
  expect(files["src/codecs.ts"]).toContain('["confidence", getU32Codec()]');
  expect(files["src/types.ts"]).toBeUndefined();
  expect(files["src/oracle.ts"]).toBeUndefined();
  expect(files["package.json"]).toContain("sol-usdc-feed-codec");
});
