import { expect, test } from "bun:test";

import { computePayloadLayout } from "../src/layout.js";
import type { PayloadSchema } from "../src/schema.js";
import { renderPayloadCodecSdk } from "../src/sdk/typescript.js";

test("renders payload codec TypeScript SDK files", () => {
  const payload: PayloadSchema = { price: "u64", confidence: "u32", slot: "u64" };
  const files = renderPayloadCodecSdk({
    name: "SolUsdcFeed",
    packageName: "sol-usdc-feed",
    programId: "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm",
    admin: "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE",
    arch: "v3",
    payload,
    layout: computePayloadLayout(payload),
  });

  expect(files["src/codecs.ts"]).toContain("export interface SolUsdcFeedPayload");
  expect(files["src/codecs.ts"]).toContain(
    "export const solUsdcFeedCodec: FixedSizeCodec<SolUsdcFeedPayload>",
  );
  expect(files["src/codecs.ts"]).toContain('["confidence", getU32Codec()]');
  expect(files["src/types.ts"]).toBeUndefined();
  expect(files["src/oracle.ts"]).toBeUndefined();
  expect(files["package.json"]).toContain("sol-usdc-feed-codec");
});
