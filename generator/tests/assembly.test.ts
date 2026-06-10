import { expect, test } from "bun:test";
import { renderDopplerAssembly, renderPayloadCopy } from "../src/assembly.js";

const ADMIN = "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE";

test("renders instruction offsets from payload size", () => {
  const assembly = renderDopplerAssembly({ admin: ADMIN, payloadSize: 20 });
  expect(assembly).toContain(".equ INSTRUCTION_SEQUENCE, 0x50ec");
  expect(assembly).toContain(".equ INSTRUCTION_PAYLOAD, 0x50f4");
  expect(assembly).toContain("lddw r3, 0xd0ab9764c9be9d08");
});

test("renders payload copies by largest chunks", () => {
  expect(renderPayloadCopy(31)).toEqual([
    "  ldxdw r2, [r1 + INSTRUCTION_PAYLOAD + 0]",
    "  stxdw [r1 + ORACLE_PAYLOAD + 0], r2",
    "  ldxdw r2, [r1 + INSTRUCTION_PAYLOAD + 8]",
    "  stxdw [r1 + ORACLE_PAYLOAD + 8], r2",
    "  ldxdw r2, [r1 + INSTRUCTION_PAYLOAD + 16]",
    "  stxdw [r1 + ORACLE_PAYLOAD + 16], r2",
    "  ldxw r2, [r1 + INSTRUCTION_PAYLOAD + 24]",
    "  stxw [r1 + ORACLE_PAYLOAD + 24], r2",
    "  ldxh r2, [r1 + INSTRUCTION_PAYLOAD + 28]",
    "  stxh [r1 + ORACLE_PAYLOAD + 28], r2",
    "  ldxb r2, [r1 + INSTRUCTION_PAYLOAD + 30]",
    "  stxb [r1 + ORACLE_PAYLOAD + 30], r2",
  ]);
});
