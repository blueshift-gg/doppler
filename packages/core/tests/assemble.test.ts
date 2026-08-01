import { expect, test } from "bun:test";

import { generateBinary } from "../src/assemble.js";

const ADMIN = "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE";

test("generates an ELF binary directly", () => {
  const binary = generateBinary({ admin: ADMIN, payloadSize: 8, arch: "v3" });
  expect(binary.slice(0, 4)).toEqual(new Uint8Array([0x7f, 0x45, 0x4c, 0x46]));
});

test("sets ELF arch flags from the requested SBPF arch", () => {
  const v0 = generateBinary({ admin: ADMIN, payloadSize: 8, arch: "v0" });
  const v3 = generateBinary({ admin: ADMIN, payloadSize: 8, arch: "v3" });

  expect(v0[0x30]).toBe(0);
  expect(v3[0x30]).toBe(3);
});

test("uses r2 as the instruction data pointer", () => {
  const binary = generateBinary({ admin: ADMIN, payloadSize: 8, arch: "v3" });

  expect(binary.slice(0x78, 0x88)).toEqual(
    new Uint8Array([
      0x69,
      0x13,
      0x08,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00, // ldxh r3, [r1 + ADMIN_HEADER]
      0x55,
      0x03,
      0x13,
      0x00,
      0xff,
      0x01,
      0x00,
      0x00, // jne r3, NO_DUP_SIGNER, error
    ]),
  );
  expect(containsBytes(binary, [0x79, 0x24, 0x00, 0x00])).toBe(true);
  expect(containsBytes(binary, [0x79, 0x13, 0xe0, 0x50])).toBe(false);
});

test("encodes admin signer key words as little-endian lddw immediates", () => {
  const binary = generateBinary({ admin: ADMIN, payloadSize: 8, arch: "v3" });

  expect(containsBytes(binary, [0x18, 0x04, 0x00, 0x00, 0x08, 0x9d, 0xbe, 0xc9])).toBe(true);
  expect(containsBytes(binary, [0x00, 0x00, 0x00, 0x00, 0x64, 0x97, 0xab, 0xd0])).toBe(true);
});

function containsBytes(bytes: Uint8Array, pattern: number[]): boolean {
  return bytes.some((_, index) =>
    pattern.every((byte, patternIndex) => bytes[index + patternIndex] === byte),
  );
}
