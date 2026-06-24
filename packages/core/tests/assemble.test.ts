import { expect, test } from "bun:test";

import { assemble } from "../src/assemble.js";
import { generateOracleProgram } from "../src/oracle.js";

const ADMIN = "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE";

test("assembles generated assembly into ELF", async () => {
  const assembly = generateOracleProgram({ admin: ADMIN, payloadSize: 8 });
  const binary = await assemble({ source: assembly, arch: "v3" });
  expect(binary.slice(0, 4)).toEqual(new Uint8Array([0x7f, 0x45, 0x4c, 0x46]));
});

test("assembles sol_memcpy assembly path into ELF", async () => {
  const assembly = generateOracleProgram({ admin: ADMIN, payloadSize: 49 });
  const binary = await assemble({ source: assembly, arch: "v3" });
  expect(binary.slice(0, 4)).toEqual(new Uint8Array([0x7f, 0x45, 0x4c, 0x46]));
});
