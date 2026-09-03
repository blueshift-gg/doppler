// Doppler feeds: `HEADER` bytes of `lastUpdatedMs` (little-endian u64), then a packed payload.

import { HEADER, generate, updateCu } from './program.js';

export { HEADER, generate, updateCu };

export const FEED_SEED = 'feed';
/** Loader-v3 programdata: tag, slot, optional authority. */
export const PROGRAMDATA_HEADER = 4 + 8 + 1 + 32;
/** Loader-v3 buffer: tag, optional authority. */
export const BUFFER_HEADER = 4 + 1 + 32;
/** Loader-v3 program: tag, programdata address. */
export const PROGRAM_LEN = 4 + 32;

/** `DEFAULT_COMPUTE_UNITS` of the compute-budget builtin. */
const BUILTIN_IX_CU = 150;
/** SIMD-0186. */
const ACCOUNT_OVERHEAD = 64;
const COMPUTE_BUDGET_PROGRAM_LEN = 'compute_budget_program'.length;

/** `Rent::default().minimum_balance`: `(ACCOUNT_STORAGE_OVERHEAD + bytes) * DEFAULT_LAMPORTS_PER_BYTE` (solana-rent). */
export function rentExempt(bytes: number): bigint {
  return BigInt(128 + bytes) * 6960n;
}

const TYPES = {
  u8: { size: 1, signed: false },
  u16: { size: 2, signed: false },
  u32: { size: 4, signed: false },
  u64: { size: 8, signed: false },
  i8: { size: 1, signed: true },
  i16: { size: 2, signed: true },
  i32: { size: 4, signed: true },
  i64: { size: 8, signed: true },
  bool: { size: 1, signed: false },
} as const;

export type Ty = keyof typeof TYPES;
export type Field = { readonly name: string; readonly type: Ty; readonly len?: number };
/** What `Doppler.load` accepts before validation: a `doppler.json` import types `type` as `string`. */
export type FieldLike = { readonly name: string; readonly type: string; readonly len?: number };
/** `doppler.json`. */
export type Manifest<F extends readonly FieldLike[] = readonly Field[]> = {
  readonly program: string;
  readonly admin: string;
  readonly fields: F;
};

type Scalar<T> = T extends 'u64' | 'i64' ? bigint : T extends 'bool' ? boolean : T extends Ty ? number : number | bigint | boolean;
type Value<K extends FieldLike> = K extends { readonly len: infer L extends number }
  ? number extends L
    ? Scalar<K['type']> | Scalar<K['type']>[]
    : L extends 1
      ? Scalar<K['type']>
      : Scalar<K['type']>[]
  : Scalar<K['type']>;
/** The value a manifest describes, one property per field, arrays for `len > 1`, bigints for 64 bits. */
export type Payload<F extends readonly FieldLike[]> = { [K in F[number] as K['name']]: Value<K> };

export type Reading<T> = { lastUpdatedMs: number; value: T };

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function key(text: unknown, what: string): Uint8Array {
  let n = 0n;
  let zeros = 0;
  for (const c of typeof text === 'string' ? text : '') {
    const digit = ALPHABET.indexOf(c);
    if (digit < 0) throw new TypeError(`${what}: a key is 32 bytes in base58`);
    n = n * 58n + BigInt(digit);
    if (n === 0n) zeros++;
  }
  const bytes = new Uint8Array(32);
  for (let i = 31; i >= zeros && n > 0n; i--, n >>= 8n) bytes[i] = Number(n & 0xffn);
  if (n > 0n || (typeof text === 'string' && text.length < 32)) throw new TypeError(`${what}: a key is 32 bytes in base58`);
  return bytes;
}

function base58(bytes: Uint8Array): string {
  let n = bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
  let out = '';
  for (; n > 0n; n /= 58n) out = ALPHABET[Number(n % 58n)] + out;
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

type Slot = { name: string; type: Ty; len: number; offset: number };

function layout(fields: unknown): { slots: Slot[]; size: number } {
  if (!Array.isArray(fields) || fields.length === 0) throw new TypeError('a payload needs at least one field');
  const slots: Slot[] = [];
  let size = 0;
  for (const field of fields as FieldLike[]) {
    const { name, type, len = 1 } = field;
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new TypeError('a field name must be an identifier');
    if (slots.some((s) => s.name === name)) throw new TypeError(`${name}: a field name must be unique`);
    if (!Object.hasOwn(TYPES, type)) throw new TypeError(`${name}: a field type is one of ${Object.keys(TYPES).join(', ')}`);
    if (!Number.isInteger(len) || len < 1 || len > 0xffff) throw new TypeError(`${name}: a field length is 1 to 65535`);
    slots.push({ name, type: type as Ty, len, offset: size });
    size += TYPES[type as Ty].size * len;
  }
  return { slots, size };
}

function get(view: DataView, at: number, type: Ty): number | bigint | boolean {
  switch (type) {
    case 'u8': return view.getUint8(at);
    case 'u16': return view.getUint16(at, true);
    case 'u32': return view.getUint32(at, true);
    case 'u64': return view.getBigUint64(at, true);
    case 'i8': return view.getInt8(at);
    case 'i16': return view.getInt16(at, true);
    case 'i32': return view.getInt32(at, true);
    case 'i64': return view.getBigInt64(at, true);
    case 'bool': return view.getUint8(at) !== 0;
  }
}

function put(view: DataView, at: number, { name, type }: Slot, x: unknown): void {
  if (type === 'bool') {
    if (typeof x !== 'boolean') throw new TypeError(`${name}: expected a boolean`);
    view.setUint8(at, x ? 1 : 0);
    return;
  }
  if (typeof x !== 'bigint' && !(typeof x === 'number' && Number.isInteger(x))) throw new TypeError(`${name}: expected an integer for ${type}`);
  const { size, signed } = TYPES[type];
  const bits = BigInt(8 * size);
  const n = BigInt(x);
  const min = signed ? -(1n << (bits - 1n)) : 0n;
  const max = (1n << (signed ? bits - 1n : bits)) - 1n;
  if (n < min || n > max) throw new RangeError(`${name}: ${x} does not fit ${type}`);
  if (size === 8) view.setBigUint64(at, BigInt.asUintN(64, n), true);
  else if (size === 4) view.setUint32(at, Number(BigInt.asUintN(32, n)), true);
  else if (size === 2) view.setUint16(at, Number(BigInt.asUintN(16, n)), true);
  else view.setUint8(at, Number(BigInt.asUintN(8, n)));
}

/** One program, one admin, one payload layout, one feed account. */
export class Feed<F extends readonly FieldLike[] = readonly Field[]> {
  private constructor(
    readonly manifest: Manifest<F>,
    /** The feed account: `createWithSeed(admin, FEED_SEED, program)`. */
    readonly address: string,
    /** Payload bytes. */
    readonly size: number,
    private readonly slots: Slot[],
    private readonly adminKey: Uint8Array,
  ) {}

  /** Validates the manifest and derives the feed address. */
  static async load<const F extends readonly FieldLike[]>(manifest: Manifest<F>): Promise<Feed<F>> {
    const program = key(manifest.program, 'program');
    const admin = key(manifest.admin, 'admin');
    const { slots, size } = layout(manifest.fields);
    const seed = new Uint8Array([...admin, ...new TextEncoder().encode(FEED_SEED), ...program]);
    const address = base58(new Uint8Array(await crypto.subtle.digest('SHA-256', seed)));
    return new Feed(manifest, address, size, slots, admin);
  }

  get program(): string {
    return this.manifest.program;
  }

  get admin(): string {
    return this.manifest.admin;
  }

  elf(): Uint8Array {
    return generate(this.adminKey, this.size);
  }

  /** Compute units and loaded bytes of one update: the admin, the compute-budget program, the program, its exact-fit programdata, and the feed. */
  budget(): { computeUnits: number; loadedBytes: number } {
    const programdata = PROGRAMDATA_HEADER + this.elf().length;
    return {
      computeUnits: 3 * BUILTIN_IX_CU + updateCu(this.size),
      loadedBytes: 5 * ACCOUNT_OVERHEAD + COMPUTE_BUDGET_PROGRAM_LEN + PROGRAM_LEN + programdata + HEADER + this.size,
    };
  }

  /** Update instruction data, which is also the feed account layout. */
  encode(lastUpdatedMs: number, value: Payload<F>): Uint8Array {
    if (!Number.isInteger(lastUpdatedMs) || lastUpdatedMs < 0) throw new RangeError('lastUpdatedMs: expected a non-negative integer');
    const data = new Uint8Array(HEADER + this.size);
    const view = new DataView(data.buffer);
    view.setBigUint64(0, BigInt(lastUpdatedMs), true);
    const fields = value as Record<string, unknown>;
    for (const slot of this.slots) {
      const x = fields[slot.name];
      const at = HEADER + slot.offset;
      if (slot.len === 1) {
        put(view, at, slot, x);
      } else {
        if (!Array.isArray(x) || x.length !== slot.len) throw new TypeError(`${slot.name}: expected ${slot.len} × ${slot.type}`);
        x.forEach((e, i) => put(view, at + i * TYPES[slot.type].size, slot, e));
      }
    }
    return data;
  }

  /** Feed account data; `owner` must be the program. */
  decode(data: ArrayBufferView, owner: string): Reading<Payload<F>> {
    if (owner !== this.program) throw new Error('the account is not owned by the feed program');
    if (data.byteLength !== HEADER + this.size) throw new Error('the account size does not match the payload');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const value: Record<string, unknown> = {};
    for (const { name, type, len, offset } of this.slots) {
      const at = HEADER + offset;
      value[name] = len === 1 ? get(view, at, type) : Array.from({ length: len }, (_, i) => get(view, at + i * TYPES[type].size, type));
    }
    return { lastUpdatedMs: Number(view.getBigUint64(0, true)), value: value as Payload<F> };
  }
}
