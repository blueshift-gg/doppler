// The program as an sBPF v3 ELF: doppler/doppler.s and doppler/doppler-memcpy.s as `sbpf` assembles them, with the
// admin key, the copy and the sizes patched in. The two programs below are doppler/doppler.so and
// doppler/doppler-memcpy.so, byte for byte; doppler/tests/vectors.json pins every result.

export const HEADER = 8;
/** Six inline chunks cost what `sol_memcpy_` costs; the memcpy program is 72 bytes smaller. */
const MEMCPY_THRESHOLD = 6;

/** The payload as stored: one 8-byte chunk per started 8 bytes, so the copy is one load/store pair per chunk. */
export const padded = (payloadSize: number) => Math.ceil(payloadSize / 8) * 8;
const chunks = (n: number) => padded(n) / 8;

/** One unit per instruction; `sol_memcpy_` costs `max(10, n / 250)` (agave mem_ops.rs). Pinned by doppler/tests/sweep.rs. */
export function updateCu(payloadSize: number): number {
  const c = chunks(payloadSize);
  if (c < MEMCPY_THRESHOLD) return 19 + 2 * c;
  return 21 + Math.max(10, Math.floor((HEADER + padded(payloadSize)) / 250));
}

const fromHex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], (b) => parseInt(b, 16));
/** doppler.s: one copy pair, 26 slots. */
const INLINE = fromHex('7f454c460201010000000000000000000300f70001000000000000000100000040000000000000000000000000000000030000004000380001004000000000000100000001000000780000000000000000000000010000000000000001000000d000000000000000d0000000000000000000000000000000691308000000000055031300ff0100007913100000000000180400000000000000000000000000005d430f00000000007913180000000000180400000000000000000000000000005d430b00000000007913200000000000180400000000000000000000000000005d430700000000007913280000000000180400000000000000000000000000005d430300000000007913c028000000007924000000000000ad43010000000000b7000000010000007b41c0280000000079240800000000007b41c828000000009500000000000000');
/** doppler-memcpy.s: 27 slots. */
const MEMCPY = fromHex('7f454c460201010000000000000000000300f70001000000000000000100000040000000000000000000000000000000030000004000380001004000000000000100000001000000780000000000000000000000010000000000000001000000d800000000000000d8000000000000000000000000000000691308000000000055031300ff0100007913100000000000180400000000000000000000000000005d430f00000000007913180000000000180400000000000000000000000000005d430b00000000007913200000000000180400000000000000000000000000005d430700000000007913280000000000180400000000000000000000000000005d430300000000007913c028000000007924000000000000ad43020000000000b7000000010000009500000000000000b70300003800000007010000c028000085000000a3c47c719500000000000000');
/** The `lddw` slots holding the admin key: the low word at slot + 4, the high word at slot + 12. */
const ADMIN_SLOTS = [3, 7, 11, 15];
/** Inline: `ldxdw r4, [r2+8]` and `stxdw [r1+0x28c8], r4`, then `exit`. */
const PAIR_SLOT = 23;
/** Memcpy: `mov64 r3, len`. */
const LEN_SLOT = 23;
const FEED_DATA = 0x28c0;

/** `p_offset`: the ELF header, then the slots. */
const CODE = 0x78;
const P_FILESZ = 0x60;
const P_MEMSZ = 0x68;

export function generate(admin: Uint8Array, payloadSize: number): Uint8Array {
  if (admin.length !== 32) throw new RangeError('an admin key is 32 bytes');
  if (!Number.isInteger(payloadSize) || payloadSize < 1) throw new RangeError('a payload needs at least one byte');
  const size = padded(payloadSize);
  const c = size / 8;
  const slot = (i: number) => CODE + 8 * i;
  let p: Uint8Array;
  let view: DataView;
  if (c < MEMCPY_THRESHOLD) {
    p = new Uint8Array(INLINE.length + 16 * (c - 1));
    view = new DataView(p.buffer);
    p.set(INLINE.subarray(0, slot(PAIR_SLOT)));
    for (let i = 0; i < c; i++) {
      const at = slot(PAIR_SLOT + 2 * i);
      p.set(INLINE.subarray(slot(PAIR_SLOT), slot(PAIR_SLOT + 2)), at);
      view.setInt16(at + 2, HEADER + 8 * i, true);
      view.setInt16(at + 10, FEED_DATA + HEADER + 8 * i, true);
    }
    p.set(INLINE.subarray(slot(PAIR_SLOT + 2)), slot(PAIR_SLOT + 2 * c));
    view.setUint32(P_FILESZ, p.length - CODE, true);
    view.setUint32(P_MEMSZ, p.length - CODE, true);
  } else {
    p = MEMCPY.slice();
    view = new DataView(p.buffer);
    view.setInt32(slot(LEN_SLOT) + 4, HEADER + size, true);
  }
  const key = new DataView(admin.buffer, admin.byteOffset, 32);
  ADMIN_SLOTS.forEach((at, i) => {
    view.setInt32(slot(at) + 4, key.getInt32(8 * i, true), true);
    view.setInt32(slot(at) + 12, key.getInt32(8 * i + 4, true), true);
  });
  return p;
}
