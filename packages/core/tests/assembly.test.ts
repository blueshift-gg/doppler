import { expect, test } from "bun:test";

import {
  countPayloadCopyPairs,
  renderAssembly,
  renderMemcpyCopy,
  renderPayloadCopy,
  shouldUseSolMemcpy,
} from "../src/assembly.js";

const ADMIN = "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE";

test("aligns instruction offsets to the payload size", () => {
  const assembly = renderAssembly({ admin: ADMIN, payloadSize: 20 });
  expect(assembly).toContain(".equ INSTRUCTION_SEQUENCE, 0x50f0");
  expect(assembly).toContain(".equ INSTRUCTION_PAYLOAD, 0x50f8");
  expect(assembly).toContain("lddw r3, 0xd0ab9764c9be9d08");
});

test("verifies admin signer flags with a single u16 comparison", () => {
  const assembly = renderAssembly({ admin: ADMIN, payloadSize: 8 });
  expect(assembly).toContain(".equ NO_DUP_SIGNER, 0x1ff");
  expect(assembly).toContain("  ldxh r2, [r1 + ADMIN_HEADER]");
  expect(assembly).toContain("  jne r2, NO_DUP_SIGNER, error_bad_admin");
  expect(assembly).not.toContain("  ldxb r2, [r1 + ADMIN_HEADER]");
  expect(assembly).not.toContain("  lddw r0, 0");
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

test("counts payload copy pairs for threshold selection", () => {
  expect(countPayloadCopyPairs(31)).toBe(6);
  expect(countPayloadCopyPairs(48)).toBe(6);
  expect(countPayloadCopyPairs(47)).toBe(8);
  expect(countPayloadCopyPairs(49)).toBe(7);
  expect(shouldUseSolMemcpy(48)).toBe(false);
  expect(shouldUseSolMemcpy(49)).toBe(true);
});

test("uses load/store path at the memcpy threshold", () => {
  const assembly = renderAssembly({ admin: ADMIN, payloadSize: 48 });
  expect(assembly).toContain("  stxdw [r1 + ORACLE_SEQUENCE], r3");
  expect(assembly).not.toContain("call sol_memcpy_");
});

test("uses sol_memcpy above the copy pair threshold", () => {
  const assembly = renderAssembly({ admin: ADMIN, payloadSize: 49 });
  expect(assembly).toContain("call sol_memcpy_");
  expect(assembly).not.toContain("  stxdw [r1 + ORACLE_SEQUENCE], r3");
  expect(assembly).not.toContain("  ldxdw r2, [r1 + INSTRUCTION_PAYLOAD + 0]");
});

test("renderMemcpyCopy copies sequence and payload together", () => {
  expect(renderMemcpyCopy(49)).toEqual([
    "  mov64 r5, r1",
    "  add64 r5, ORACLE_SEQUENCE",
    "  add64 r1, INSTRUCTION_SEQUENCE",
    "  mov64 r2, r1",
    "  mov64 r1, r5",
    "  mov64 r3, 57",
    "  call sol_memcpy_",
  ]);
});

test("keeps default payload on the load/store path", () => {
  const assembly = renderAssembly({ admin: ADMIN, payloadSize: 8 });
  expect(assembly).toContain("  stxdw [r1 + ORACLE_SEQUENCE], r3");
  expect(assembly).toContain("  ldxdw r2, [r1 + INSTRUCTION_PAYLOAD + 0]");
  expect(assembly).not.toContain("call sol_memcpy_");
});
