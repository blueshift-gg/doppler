import { expect, test } from "bun:test";
import { decodeSolanaPublicKey, publicKeyToU64Words } from "../src/public-key.js";

const ADMIN = "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE";

test("decodes Solana public keys", () => {
  expect(decodeSolanaPublicKey(ADMIN)).toHaveLength(32);
});

test("converts public key to little-endian u64 words", () => {
  expect(publicKeyToU64Words(ADMIN)).toEqual([
    0xd0ab9764c9be9d08n,
    0x4bb9ba69527921dbn,
    0x5494aa05cc49b8c8n,
    0xd151cbec76dca5d0n,
  ]);
});

test("rejects invalid public keys", () => {
  expect(() => decodeSolanaPublicKey("not-valid")).toThrow("Invalid Solana address");
});
