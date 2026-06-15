import { expect, test } from "bun:test";

import { renderDopplerAssembly } from "../src/assembly.js";
import { compileAssemblyToBytecode } from "../src/bytecode.js";

const ADMIN = "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE";

test("compiles generated assembly into ELF bytecode", () => {
  const assembly = renderDopplerAssembly({ admin: ADMIN, payloadSize: 8 });
  const bytecode = compileAssemblyToBytecode({ assemblySource: assembly, arch: "v3" });
  expect(bytecode.slice(0, 4)).toEqual(new Uint8Array([0x7f, 0x45, 0x4c, 0x46]));
});
