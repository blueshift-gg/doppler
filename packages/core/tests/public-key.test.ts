import { expect, test } from "bun:test";

import { decodeSolanaPublicKey } from "../src/public-key.js";

const ADMIN = "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE";

test("decodes Solana public keys", () => {
  expect(decodeSolanaPublicKey(ADMIN)).toHaveLength(32);
});

test("rejects invalid public keys", () => {
  expect(() => decodeSolanaPublicKey("not-valid")).toThrow("Invalid Solana address");
});
