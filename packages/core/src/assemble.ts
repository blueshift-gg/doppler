import { SBPF_ASSEMBLER_VERSIONS, type SbpfArch } from "./config.js";
import { decodeSolanaPublicKey } from "./public-key.js";

// ELF header (0x40) + program header (0x38); the loadable segment follows.
const HEADER_SIZE = 0x78;
const E_FLAGS_OFFSET = 0x30;
// Offsets of the program header's p_filesz / p_memsz fields, patched per program.
const P_FILESZ_OFFSET = 0x60;
const P_MEMSZ_OFFSET = 0x68;

export type OracleBinaryInput = {
  admin: string;
  payloadSize: number;
  arch?: SbpfArch;
};

// Generate a program for a fixed-size Doppler<T>. The type's length (counter +
// generic payload) is captured once; the returned fn emits the binary per input.
export function generateBinary({ admin, payloadSize, arch = "v3" }: OracleBinaryInput): Uint8Array {
  if (!Number.isInteger(payloadSize) || payloadSize <= 0) {
    throw new Error("payloadSize must be a positive integer");
  }

  return generateProgram(decodeSolanaPublicKey(admin), COUNTER_SIZE + payloadSize, arch);
}

function generateProgram(admin: Uint8Array, size: number, arch: SbpfArch): Uint8Array {
  const program = new Uint8Array([
    ...HEADER,
    ...signerKeyCheck(admin),
    ...updateOracle(size), // gate counter, write counter, copy payload, exit
  ]);

  program.set(imm(SBPF_ASSEMBLER_VERSIONS[arch]), E_FLAGS_OFFSET);

  // p_filesz / p_memsz = the loadable segment: everything after the headers.
  const segmentSize = program.length - HEADER_SIZE;
  program.set(imm(segmentSize), P_FILESZ_OFFSET);
  program.set(imm(segmentSize), P_MEMSZ_OFFSET);

  return program;
}

const HEADER = new Uint8Array([
  // ELF header
  0x7f,
  0x45,
  0x4c,
  0x46,
  0x02,
  0x01,
  0x01,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x03,
  0x00,
  0xf7,
  0x00,
  0x01,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  0x00,
  0x00,
  0x40,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x03,
  0x00,
  0x00,
  0x00,
  0x40,
  0x00,
  0x38,
  0x00,
  0x01,
  0x00,
  0x40,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  // Program header
  0x01,
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  0x00,
  0x00,
  0x78,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  0x00,
  0x00,
  0xd0,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0xd0,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  // Program start
  0x69,
  0x13,
  0x08,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00, // get signer header
  0x55,
  0x03,
  0x13,
  0x00,
  0xff,
  0x01,
  0x00,
  0x00, // if signer header ≠ 0x01ff, jump to err
]);

// Check against our admin key
const signerKeyCheck = (admin: Uint8Array): Uint8Array =>
  new Uint8Array(
    [0, 1, 2, 3].flatMap((g) => [
      0x79,
      0x13,
      0x10 + g * 8,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00, // load signer key segment into r3
      0x18,
      0x04,
      0x00,
      0x00,
      ...admin.slice(g * 8, g * 8 + 4), // expected key low half into r4
      0x00,
      0x00,
      0x00,
      0x00,
      ...admin.slice(g * 8 + 4, g * 8 + 8), // expected key high half
      0x5d,
      0x43,
      0x0f - g * 4,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00, // if r3 ≠ r4, jump to err
    ]),
  );

// Counter monotonicity gate: require the ix counter (r4) to exceed the stored
// one (r3), else set error code 1 in r0 and fail. The happy path jumps over the
// error handler. With inline copies nothing touches r0 before the final exit, so
// the error path can fall through (smaller binary). But sol_memcpy_ returns
// SUCCESS into r0, clobbering the error code — so the memcpy path needs an
// explicit error EXIT before the write, and the happy path skips one more.
const counterGate = (useMemcpy: boolean): Uint8Array =>
  new Uint8Array([
    0x79,
    0x13,
    0xc0,
    0x28,
    0x00,
    0x00,
    0x00,
    0x00, // load counter from account into r3
    0x79,
    0x24,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00, // load counter from ix data into r4
    0xad,
    0x43,
    useMemcpy ? 0x02 : 0x01,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00, // if r3 < r4, jump past error handler
    0xb7,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00, // load error code 1 into r0
    ...(useMemcpy ? EXIT : []), // memcpy clobbers r0, so exit before the write
  ]);

const UPDATE_COUNTER = new Uint8Array([0x7b, 0x41, 0xc0, 0x28, 0x00, 0x00, 0x00, 0x00]); // update counter

const getCopies = (size: number): number[] => [
  ...Array(size >> 3).fill(8), // Fill total number of 8 byte copies first
  ...[4, 2, 1].filter((width) => size & width), // Fill remainder
];

// Each copy width maps to its [ldx, stx] opcode pair.
const COPY_OPCODES: Record<number, [number, number]> = {
  8: [0x79, 0x7b], // ldxdw / stxdw
  4: [0x61, 0x63], // ldxw  / stxw
  2: [0x69, 0x6b], // ldxh  / stxh
  1: [0x71, 0x73], // ldxb  / stxb
};

// The counter is a u64 prefix; the payload lives right after it, in both the ix
// data and the account.
const COUNTER_SIZE = 8;
const ACCOUNT_COUNTER_OFFSET = 0x28c0;
const ACCOUNT_PAYLOAD_OFFSET = ACCOUNT_COUNTER_OFFSET + COUNTER_SIZE; // 0x28c8
const IX_PAYLOAD_OFFSET = COUNTER_SIZE; // 0x08

// At 7 chunks inline (2 CU each = 14) ties sol_memcpy's CU, so switch there to
// keep CU flat while shrinking the binary; beyond 7, memcpy is also cheaper CU.
const MEMCPY_THRESHOLD = 7;

// sol_memcpy_ syscall key — murmur3_32 hash of the symbol name.
const SOL_MEMCPY = 0x717cc4a3;

const EXIT = new Uint8Array([0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]); // exit

// 32-bit little-endian immediate.
const imm = (n: number): Uint8Array =>
  new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);

// Unrolled load/store pairs: ldx a chunk from ix data into r4, stx it into the
// account. Both offsets advance by the same width, so one accumulator tracks both.
const inlinePayload = (copies: number[]): Uint8Array => {
  let offset = 0;
  return new Uint8Array(
    copies.flatMap((width) => {
      const [ldx, stx] = COPY_OPCODES[width]!;
      const ix = IX_PAYLOAD_OFFSET + offset;
      const account = ACCOUNT_PAYLOAD_OFFSET + offset;
      offset += width;
      return [
        ldx,
        0x24,
        ix & 0xff,
        (ix >> 8) & 0xff,
        0x00,
        0x00,
        0x00,
        0x00, // load payload chunk from ix data into r4
        stx,
        0x41,
        account & 0xff,
        (account >> 8) & 0xff,
        0x00,
        0x00,
        0x00,
        0x00, // store r4 into account
      ];
    }),
  );
};

// sol_memcpy_(dst = account + counter, src = ix data, n = r3). The copy bundles
// counter + payload as one block: src is r2 as-is (ix offset 0), so the counter is
// written here and needs no separate UPDATE_COUNTER. The caller sets n in r3.
const memcpyCall = (): Uint8Array =>
  new Uint8Array([
    0x07,
    0x01,
    0x00,
    0x00,
    ...imm(ACCOUNT_COUNTER_OFFSET), // r1 += counter offset → dst
    0x85,
    0x00,
    0x00,
    0x00,
    ...imm(SOL_MEMCPY), // call sol_memcpy_(r1, r2, r3)
  ]);

// Fixed-size: n = counter + payload length, known at generation time.
const memcpyPayload = (size: number): Uint8Array =>
  new Uint8Array([
    0xb7,
    0x03,
    0x00,
    0x00,
    ...imm(size), // r3 = counter + payload length (n)
    ...memcpyCall(),
  ]);

const updateOracle = (size: number): Uint8Array => {
  const copies = getCopies(size - COUNTER_SIZE);
  if (copies.length >= MEMCPY_THRESHOLD) {
    return new Uint8Array([...counterGate(true), ...memcpyPayload(size), ...EXIT]);
  }

  // Inline path writes the counter separately, reusing r4 from the gate.
  return new Uint8Array([
    ...counterGate(false),
    ...UPDATE_COUNTER,
    ...inlinePayload(copies),
    ...EXIT,
  ]);
};
