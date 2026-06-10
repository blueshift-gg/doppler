import { bigintToHexLiteral, publicKeyToU64Words } from "./public-key.js";

export type AssemblyInput = {
  admin: string;
  payloadSize: number;
};

const ADMIN_HEADER = 0x0008;
const ADMIN_KEY = 0x0010;
const ORACLE_SEQUENCE = 0x28c0;
const ORACLE_PAYLOAD = 0x28c8;
const INSTRUCTION_BASE_SEQUENCE = 0x50d8;
const INSTRUCTION_BASE_PAYLOAD = 0x50e0;

export function renderDopplerAssembly(input: AssemblyInput): string {
  if (!Number.isInteger(input.payloadSize) || input.payloadSize <= 0) {
    throw new Error("payloadSize must be a positive integer");
  }

  const adminWords = publicKeyToU64Words(input.admin).map(bigintToHexLiteral);
  const instructionSequence = INSTRUCTION_BASE_SEQUENCE + input.payloadSize;
  const instructionPayload = INSTRUCTION_BASE_PAYLOAD + input.payloadSize;

  return [
    ".equ ADMIN_HEADER, 0x0008",
    ".equ ADMIN_KEY, 0x0010",
    ".equ ORACLE_SEQUENCE, 0x28c0",
    ".equ ORACLE_PAYLOAD, 0x28c8",
    `.equ INSTRUCTION_SEQUENCE, ${hex(instructionSequence)}`,
    `.equ INSTRUCTION_PAYLOAD, ${hex(instructionPayload)}`,
    "",
    ".globl entrypoint",
    "",
    "entrypoint:",
    "  ldxb r2, [r1 + ADMIN_HEADER]",
    "  jne r2, 0xff, error_bad_admin",
    "  ldxb r2, [r1 + ADMIN_HEADER + 1]",
    "  jne r2, 0x01, error_bad_admin",
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
    "  lddw r0, 0",
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
  ORACLE_SEQUENCE,
  ORACLE_PAYLOAD,
  INSTRUCTION_BASE_SEQUENCE,
  INSTRUCTION_BASE_PAYLOAD,
} as const;

function hex(value: number): string {
  return `0x${value.toString(16)}`;
}
