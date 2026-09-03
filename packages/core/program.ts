// The program as an sBPF v3 ELF, byte for byte what doppler/src/elf.rs emits. Listing: doppler/doppler.s.

export const HEADER = 8;
const MEMCPY_THRESHOLD = 7;

const chunks = (n: number) => (n >> 3) + (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1);

/** One unit per instruction; `sol_memcpy_` costs `max(10, n / 250)` (agave mem_ops.rs). Pinned by doppler/tests/sweep.rs. */
export function updateCu(payloadSize: number): number {
  const c = chunks(payloadSize);
  if (c < MEMCPY_THRESHOLD) return 19 + 2 * c;
  return 21 + Math.max(10, Math.floor((HEADER + payloadSize) / 250));
}

const LDXB = 0x71, LDXH = 0x69, LDXW = 0x61, LDXDW = 0x79;
const STXB = 0x73, STXH = 0x6b, STXW = 0x63, STXDW = 0x7b;
const LDDW = 0x18, ADD64_IMM = 0x07, MOV64_IMM = 0xb7;
const JNE_IMM = 0x55, JNE_REG = 0x5d, JLT_REG = 0xad;
const CALL = 0x85, EXIT = 0x95;

const ADMIN_FLAGS = 0x08;
const NOT_DUP_SIGNER = 0x01ff;
const ADMIN_KEY = 0x10;
const FEED_DATA = 0x28c0;
/** murmur3_32("sol_memcpy_") */
const SOL_MEMCPY = 0x717cc4a3;

// prettier-ignore
const ELF = Uint8Array.of(
  0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, // ELF64 LE
  3, 0, 0xf7, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, // ET_DYN EM_BPF, e_entry 1<<32
  0x40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // e_phoff 0x40, e_shoff 0
  3, 0, 0, 0, 0x40, 0, 0x38, 0, 1, 0, 0x40, 0, 0, 0, 0, 0, // e_flags v3, 1 phdr, 0 shdr
  1, 0, 0, 0, 1, 0, 0, 0, 0x78, 0, 0, 0, 0, 0, 0, 0, // PT_LOAD PF_X, p_offset 0x78
  0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, // p_vaddr p_paddr 1<<32
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // p_filesz p_memsz: patched
  0, 0, 0, 0, 0, 0, 0, 0, // p_align 0
);
const P_FILESZ = 0x60;
const P_MEMSZ = 0x68;

const widths = (n: number) => [...Array<number>(n >> 3).fill(8), ...[4, 2, 1].filter((w) => n & w)];

export function generate(admin: Uint8Array, payloadSize: number): Uint8Array {
  if (admin.length !== 32) throw new RangeError('an admin key is 32 bytes');
  if (!Number.isInteger(payloadSize) || payloadSize < 1) throw new RangeError('a payload needs at least one byte');
  const size = HEADER + payloadSize;
  const memcpy = chunks(payloadSize) >= MEMCPY_THRESHOLD;
  const count = 2 + 16 + 4 + (memcpy ? 4 : 1 + 2 * chunks(payloadSize)) + 1;
  const p = new Uint8Array(ELF.length + 8 * count);
  const view = new DataView(p.buffer);
  p.set(ELF);
  let at = ELF.length;
  const insn = (op: number, dst: number, src: number, off: number, imm: number) => {
    p[at] = op;
    p[at + 1] = (src << 4) | dst;
    view.setInt16(at + 2, off, true);
    view.setInt32(at + 4, imm, true);
    at += 8;
  };

  insn(LDXH, 3, 1, ADMIN_FLAGS, 0);
  insn(JNE_IMM, 3, 0, 19, NOT_DUP_SIGNER);
  const key = new DataView(admin.buffer, admin.byteOffset, 32);
  for (let i = 0; i < 4; i++) {
    insn(LDXDW, 3, 1, ADMIN_KEY + 8 * i, 0);
    insn(LDDW, 4, 0, 0, key.getInt32(8 * i, true));
    insn(0, 0, 0, 0, key.getInt32(8 * i + 4, true));
    insn(JNE_REG, 3, 4, 15 - 4 * i, 0);
  }

  insn(LDXDW, 3, 1, FEED_DATA, 0);
  insn(LDXDW, 4, 2, 0, 0);
  insn(JLT_REG, 3, 4, memcpy ? 2 : 1, 0);
  insn(MOV64_IMM, 0, 0, 0, 1);
  if (memcpy) {
    insn(EXIT, 0, 0, 0, 0);
    insn(MOV64_IMM, 3, 0, 0, size);
    insn(ADD64_IMM, 1, 0, 0, FEED_DATA);
    insn(CALL, 0, 0, 0, SOL_MEMCPY);
  } else {
    insn(STXDW, 1, 4, FEED_DATA, 0);
    let off = HEADER;
    for (const width of widths(payloadSize)) {
      const [ldx, stx] = width === 8 ? [LDXDW, STXDW] : width === 4 ? [LDXW, STXW] : width === 2 ? [LDXH, STXH] : [LDXB, STXB];
      insn(ldx, 4, 2, off, 0);
      insn(stx, 1, 4, FEED_DATA + off, 0);
      off += width;
    }
  }
  insn(EXIT, 0, 0, 0, 0);

  view.setUint32(P_FILESZ, at - ELF.length, true);
  view.setUint32(P_MEMSZ, at - ELF.length, true);
  return p;
}
