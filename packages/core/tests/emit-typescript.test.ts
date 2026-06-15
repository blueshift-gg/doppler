import { expect, test } from "bun:test";

import { computePayloadLayout } from "../src/layout.js";
import type { PayloadSchema } from "../src/schema.js";
import { renderCoreSdk } from "../src/sdk/typescript.js";

test("renders core TypeScript SDK files", async () => {
  const payload: PayloadSchema = { price: "u64", confidence: "u32", slot: "u64" };
  const files = await renderCoreSdk({
    name: "SolUsdcFeed",
    packageName: "sol-usdc-feed",
    programId: "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm",
    admin: "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE",
    arch: "v3",
    payload,
    layout: computePayloadLayout(payload),
  });

  expect(files["src/types.ts"]).toContain("export interface SolUsdcFeedPayload");
  expect(files["src/constants.ts"]).toContain('export const ARCH = "v3";');
  expect(files["src/serializers.ts"]).toContain("solUsdcFeedSerializer");
  expect(files["src/serializers.ts"]).toContain("getU64Codec()");
  expect(files["src/oracle.ts"]).toContain("deserializeOracle");
  expect(files["package.json"]).toContain("sol-usdc-feed-core");
});
