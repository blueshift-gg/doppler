import { bigintToHexLiteral, publicKeyToU64Words } from "./public-key.js";

export type AssemblyInput = {
  admin: string;
  payloadSize: number;
};

const ADMIN_HEADER = 0x0008;
const ADMIN_KEY = 0x0010;
const NO_DUP_SIGNER = 0x01ff;
const ORACLE_SEQUENCE = 0x28c0;
const ORACLE_PAYLOAD = 0x28c8;
const INSTRUCTION_BASE_SEQUENCE = 0x50d8;
const INSTRUCTION_BASE_PAYLOAD = 0x50e0;

/**
 * Render SBPF assembly source for a Doppler oracle program.
 *
 * - Validates the admin signer
 * - Enforces monotonic sequence numbers
 * - Copies the instruction payload into the oracle account
 */
export function renderAssembly(input: AssemblyInput): string {
  if (!Number.isInteger(input.payloadSize) || input.payloadSize <= 0) {
    throw new Error("payloadSize must be a positive integer");
  }

  const adminWords = publicKeyToU64Words(input.admin).map(bigintToHexLiteral);
  const alignedPayloadSize = alignToEightBytes(input.payloadSize);
  const instructionSequence = INSTRUCTION_BASE_SEQUENCE + alignedPayloadSize;
  const instructionPayload = INSTRUCTION_BASE_PAYLOAD + alignedPayloadSize;

  return [
    `.equ ADMIN_HEADER, ${hex(ADMIN_HEADER)}`,
    `.equ ADMIN_KEY, ${hex(ADMIN_KEY)}`,
    `.equ NO_DUP_SIGNER, ${hex(NO_DUP_SIGNER)}`,
    `.equ ORACLE_SEQUENCE, ${hex(ORACLE_SEQUENCE)}`,
    `.equ ORACLE_PAYLOAD, ${hex(ORACLE_PAYLOAD)}`,
    `.equ INSTRUCTION_SEQUENCE, ${hex(instructionSequence)}`,
    `.equ INSTRUCTION_PAYLOAD, ${hex(instructionPayload)}`,
    "",
    ".globl entrypoint",
    "",
    "entrypoint:",
    "  ldxh r2, [r1 + ADMIN_HEADER]",
    "  jne r2, NO_DUP_SIGNER, error_bad_admin",
    "",
    ...adminWords.flatMap((word, index) => [
      `  ldxdw r2, [r1 + ADMIN_KEY + ${index * 8}]`,
      `  lddw r3, ${word}`,
      "  jne r2, r3, error_bad_admin",
    ]),
    "",
    "  ldxdw r2, [r1 + ORACLE_SEQUENCE]",
    "  ldxdw r3, [r1 + INSTRUCTION_SEQUENCE]",
    "  jge r2, r3, error_stale_sequence",
    "  stxdw [r1 + ORACLE_SEQUENCE], r3",
    "",
    ...renderPayloadCopy(input.payloadSize),
    "",
    "  exit",
    "",
    "error_bad_admin:",
    "  lddw r0, 1",
    "  exit",
    "",
    "error_stale_sequence:",
    "  lddw r0, 2",
    "  exit",
    "",
  ].join("\n");
}

/** Emit load/store instruction pairs that copy `payloadSize` bytes into the oracle account. */
export function renderPayloadCopy(payloadSize: number): string[] {
  const instructions: string[] = [];
  let offset = 0;

  for (const chunk of [
    { size: 8, load: "ldxdw", store: "stxdw" },
    { size: 4, load: "ldxw", store: "stxw" },
    { size: 2, load: "ldxh", store: "stxh" },
    { size: 1, load: "ldxb", store: "stxb" },
  ]) {
    while (offset + chunk.size <= payloadSize) {
      instructions.push(
        `  ${chunk.load} r2, [r1 + INSTRUCTION_PAYLOAD + ${offset}]`,
        `  ${chunk.store} [r1 + ORACLE_PAYLOAD + ${offset}], r2`,
      );
      offset += chunk.size;
    }
  }

  return instructions;
}

export const DOPPLER_OFFSETS = {
  ADMIN_HEADER,
  ADMIN_KEY,
  NO_DUP_SIGNER,
  ORACLE_SEQUENCE,
  ORACLE_PAYLOAD,
  INSTRUCTION_BASE_SEQUENCE,
  INSTRUCTION_BASE_PAYLOAD,
} as const;

function hex(value: number): string {
  return `0x${value.toString(16)}`;
}

function alignToEightBytes(value: number): number {
  return (value + 7) & ~7;
}
