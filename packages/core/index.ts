// Doppler feeds: `HEADER` bytes of `sequence` (little-endian u64, strictly increasing), then the packed payload,
// padded to 8 bytes.

import { HEADER, generate, padded, updateCu } from './program.js';
import { DOMAIN, generatePull, pullCu } from './pull.js';

export { DOMAIN, HEADER, generate, generatePull, padded, pullCu, updateCu };

export const FEED_SEED = 'feed';
/** The buffer lives only inside the deploy transaction, so one seed serves every deploy. */
export const BUFFER_SEED = 'buf';
/** Loader-v3 programdata: tag, slot, optional authority. */
export const PROGRAMDATA_HEADER = 4 + 8 + 1 + 32;
/** Loader-v3 buffer: tag, optional authority. */
export const BUFFER_HEADER = 4 + 1 + 32;
/** Loader-v3 program: tag, programdata address. */
export const PROGRAM_LEN = 4 + 32;

/** `DEFAULT_COMPUTE_UNITS` of the system and compute-budget builtins. */
export const BUILTIN_IX_CU = 150;
/** `DEFAULT_COMPUTE_UNITS` of loader v3; its deploy also CPIs one system `create_account`. */
export const LOADER_IX_CU = 2_370;
/**
 * Builtin and sysvar data as loaded, by address: the system program, 21 bytes on mainnet and 14 on
 * devnet, where a limit only needs to cover the larger; the loader; the rent and clock sysvars.
 */
export const BUILTIN_LEN: Readonly<Record<string, number>> = {
  '11111111111111111111111111111111': 21,
  BPFLoaderUpgradeab1e11111111111111111111111: 37,
  SysvarRent111111111111111111111111111111111: 17,
  SysvarC1ock11111111111111111111111111111111: 40,
};
/** SIMD-0186. */
export const ACCOUNT_OVERHEAD = 64;
const COMPUTE_BUDGET_PROGRAM_LEN = 'compute_budget_program'.length;
/** `FeeStructure::default()`. */
const LAMPORTS_PER_SIGNATURE = 5_000n;

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
/** What `DopplerClient.load` accepts before validation: a `doppler.json` import types `type` as `string`. */
export type FieldLike = { readonly name: string; readonly type: string; readonly len?: number };
/**
 * `doppler.json`: a feed is its admin and its seed. The program is `createWithSeed(admin, seed, loader)`,
 * the feed account `createWithSeed(admin, 'feed', program)`. `pull` is the program with the second write
 * path: the admin's detached signature over an update, from anyone.
 */
export type Manifest<F extends readonly FieldLike[] = readonly Field[]> = {
  readonly admin: string;
  readonly seed: string;
  readonly pull?: boolean;
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

/** `sequence` is whatever the publisher writes; the clients write unix milliseconds. */
export type Reading<T> = { sequence: number; value: T };

/**
 * What an update needs. `computeUnits` and `loadedBytes` are the instruction's own: the program's units,
 * and its program, programdata and feed at SIMD-0186's 64 bytes plus data. The `requested` pair is what
 * `send` sets for a transaction holding only the update: three compute-budget builtins at 150 units, and
 * the payer and the compute-budget program. `lamports` is that transaction's fee at the unit price.
 */
export type Budget = {
  computeUnits: number;
  loadedBytes: number;
  requestedComputeUnits: number;
  requestedLoadedBytes: number;
  lamports: bigint;
};

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';

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

/** `unitPrice` is micro-lamports per compute unit; the fee is `5000` per signature plus `ceil(unitPrice * units / 1e6)`. */
export function budget(computeUnits: number, loadedBytes: number, signatures: number, unitPrice: number | bigint): Budget {
  const requestedComputeUnits = computeUnits + 3 * BUILTIN_IX_CU;
  const priority = (BigInt(unitPrice) * BigInt(requestedComputeUnits) + 999_999n) / 1_000_000n;
  return {
    computeUnits,
    loadedBytes,
    requestedComputeUnits,
    requestedLoadedBytes: loadedBytes + 2 * ACCOUNT_OVERHEAD + COMPUTE_BUDGET_PROGRAM_LEN,
    lamports: BigInt(signatures) * LAMPORTS_PER_SIGNATURE + priority,
  };
}

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
    /** `createWithSeed(admin, seed, loader)`. */
    readonly program: string,
    /** The feed account: `createWithSeed(admin, FEED_SEED, program)`. */
    readonly address: string,
    /** Payload bytes. */
    readonly size: number,
    private readonly slots: Slot[],
    private readonly adminKey: Uint8Array,
  ) {}

  /** Validates the manifest and derives the program and the feed address. */
  static async load<const F extends readonly FieldLike[]>(manifest: Manifest<F>): Promise<Feed<F>> {
    const admin = key(manifest.admin, 'admin');
    const seed = new TextEncoder().encode(typeof manifest.seed === 'string' ? manifest.seed : '');
    if (seed.length < 1 || seed.length > 32) throw new TypeError('seed: a seed is 1 to 32 bytes');
    const { slots, size } = layout(manifest.fields);
    const withSeed = async (base: Uint8Array, seed: Uint8Array, owner: Uint8Array) =>
      new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([...base, ...seed, ...owner])));
    const program = await withSeed(admin, seed, key(LOADER, 'loader'));
    const address = await withSeed(admin, new TextEncoder().encode(FEED_SEED), program);
    return new Feed(manifest, base58(program), base58(address), size, slots, admin);
  }

  get admin(): string {
    return this.manifest.admin;
  }

  elf(): Uint8Array {
    return this.manifest.pull ? generatePull(this.adminKey, key(this.program, 'program'), this.size) : generate(this.adminKey, this.size);
  }

  /** What a write to the feed loads: the program, its programdata, the feed. */
  private feedLoadedBytes(): number {
    return 3 * ACCOUNT_OVERHEAD + PROGRAM_LEN + PROGRAMDATA_HEADER + this.elf().length + HEADER + padded(this.size);
  }

  /** One update; the admin signs. */
  updateBudget(unitPrice: number | bigint): Budget {
    return budget(updateCu(this.size), this.feedLoadedBytes(), 1, unitPrice);
  }

  /** One pull; whoever pays signs. */
  pullBudget(unitPrice: number | bigint): Budget {
    if (!this.manifest.pull) throw new Error('the manifest has no pull path');
    return budget(pullCu(this.size), this.feedLoadedBytes(), 1, unitPrice);
  }

  /** What the admin signs for a pull: `DOMAIN`, the program id, then the update. */
  pullMessage(update: Uint8Array): Uint8Array {
    if (!this.manifest.pull) throw new Error('the manifest has no pull path');
    return new Uint8Array([...DOMAIN, ...key(this.program, 'program'), ...update]);
  }

  /** `Update.sign`'s bytes: the signature, then the update, exactly the feed's size. */
  checkSigned(signed: Uint8Array): Uint8Array {
    if (!this.manifest.pull) throw new Error('the manifest has no pull path');
    const expected = 64 + HEADER + padded(this.size);
    if (signed.length !== expected) throw new RangeError(`a signed update is ${expected} bytes, got ${signed.length}`);
    return signed;
  }

  /** Update instruction data, which is also the feed account layout: the payload padded to 8 bytes. */
  encode(sequence: number, value: Payload<F>): Uint8Array {
    if (!Number.isInteger(sequence) || sequence < 0) throw new RangeError('sequence: expected a non-negative integer');
    const data = new Uint8Array(HEADER + padded(this.size));
    const view = new DataView(data.buffer);
    view.setBigUint64(0, BigInt(sequence), true);
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
    if (data.byteLength !== HEADER + padded(this.size)) throw new Error('the account size does not match the payload');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const value: Record<string, unknown> = {};
    for (const { name, type, len, offset } of this.slots) {
      const at = HEADER + offset;
      value[name] = len === 1 ? get(view, at, type) : Array.from({ length: len }, (_, i) => get(view, at + i * TYPES[type].size, type));
    }
    return { sequence: Number(view.getBigUint64(0, true)), value: value as Payload<F> };
  }
}
