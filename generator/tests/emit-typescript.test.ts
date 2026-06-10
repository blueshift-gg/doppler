import { expect, test } from "bun:test";
import { loadGeneratorConfig } from "../src/config.js";
import { renderTypeScriptSdk } from "../src/sdk/typescript.js";
import type { PayloadSchema } from "../src/schema.js";

test("renders TypeScript SDK files", async () => {
  const config = await loadGeneratorConfig("unused.json", {
    name: "SolUsdcFeed",
    programId: "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm",
    admin: "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE",
  }).catch(async () => {
    const payload: PayloadSchema = { price: "u64", confidence: "u32", slot: "u64" };
    const { computePayloadLayout } = await import("../src/layout.js");
    return {
      name: "SolUsdcFeed",
      packageName: "sol-usdc-feed",
      programId: "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm",
      admin: "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE",
      arch: "v3" as const,
      payload,
      layout: computePayloadLayout(payload),
    };
  });

  const files = renderTypeScriptSdk(config);
  expect(files["types.ts"]).toContain("export interface SolUsdcFeedPayload");
  expect(files["constants.ts"]).toContain('export const ARCH = "v3";');
  expect(files["serializers.ts"]).toContain("solUsdcFeedSerializer");
  expect(files["serializers.ts"]).toContain("getU64Codec()");
});
