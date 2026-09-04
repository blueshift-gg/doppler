import { expect, test } from 'bun:test';
import vectors from '../../doppler/tests/vectors.json' with { type: 'json' };
import { BUFFER_HEADER, Feed, HEADER, PROGRAM_LEN, rentExempt, updateCu } from './index.js';

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], (b) => parseInt(b, 16));
const { program, admin } = vectors;
const price = [
  { name: 'price', type: 'i64' },
  { name: 'conf', type: 'u64' },
  { name: 'expo', type: 'i32' },
] as const;
const value = { price: 17_234_000_000n, conf: 5_000_000n, expo: -8 };

test.each(vectors.programs)('program for $payloadSize bytes matches the Rust emitter', async ({ payloadSize, cu, elf }) => {
  const feed = await Feed.load({ program, admin, fields: [{ name: 'x', type: 'u8', len: payloadSize }] });
  expect(hex(feed.elf())).toBe(elf);
  expect(updateCu(payloadSize)).toBe(cu);
});

test('the feed address is create_with_seed(admin, "feed", program)', async () => {
  const feed = await Feed.load({ program, admin, fields: price });
  expect(feed.address).toBe(vectors.feed);
  expect(feed.size).toBe(20);
});

test('price round trips through the wire format with the exact budget', async () => {
  const feed = await Feed.load({ program, admin, fields: price });
  const data = feed.encode(vectors.price.sequence, value);
  expect(hex(data)).toBe(vectors.price.data);
  expect(feed.decode(fromHex(vectors.price.data), program)).toEqual({ sequence: 5, value });
  expect(feed.budget()).toEqual({ computeUnits: vectors.price.computeUnits, loadedBytes: vectors.price.loadedBytes });
  expect(rentExempt(BUFFER_HEADER + feed.elf().length)).toBe(BigInt(vectors.deploy.bufferLamports));
  expect(rentExempt(PROGRAM_LEN)).toBe(BigInt(vectors.deploy.programLamports));
  expect(rentExempt(HEADER + feed.size)).toBe(BigInt(vectors.deploy.feedLamports));
});

test('every type and arrays round trip', async () => {
  const feed = await Feed.load({
    program,
    admin,
    fields: [
      { name: 'a', type: 'i8' },
      { name: 'b', type: 'u16', len: 2 },
      { name: 'c', type: 'bool' },
      { name: 'd', type: 'i16' },
      { name: 'e', type: 'u32' },
      { name: 'f', type: 'i64', len: 1 },
    ],
  });
  const value = { a: -1, b: [65535, 7], c: true, d: -32768, e: 4294967295, f: -1n };
  const data = feed.encode(1, value);
  expect(data.length).toBe(HEADER + 20);
  expect(data[HEADER]).toBe(0xff);
  expect(feed.decode(data, program).value).toEqual(value);
});

test('load rejects bad manifests', async () => {
  const load = (fields: unknown, keys = { program, admin }) => Feed.load({ ...keys, fields: fields as never });
  await expect(load([{ name: 'x', type: 'u8' }], { program: 'short', admin })).rejects.toThrow('program: a key is 32 bytes in base58');
  await expect(load([{ name: 'x', type: 'u8' }], { program, admin: 'O' + admin.slice(1) })).rejects.toThrow('admin: a key');
  await expect(load([])).rejects.toThrow('at least one field');
  await expect(load([{ name: 'bad-name', type: 'u8' }])).rejects.toThrow('identifier');
  await expect(load([{ name: '1st', type: 'u8' }])).rejects.toThrow('identifier');
  await expect(load([{ name: 'x', type: 'u128' }])).rejects.toThrow('x: a field type is one of');
  await expect(load([{ name: 'x', type: 'u8', len: 0 }])).rejects.toThrow('x: a field length');
  await expect(load([{ name: 'x', type: 'u8' }, { name: 'x', type: 'u8' }])).rejects.toThrow('x: a field name must be unique');
});

test('encode and decode reject what does not fit', async () => {
  const feed = await Feed.load({ program, admin, fields: [{ name: 'x', type: 'u8', len: 2 }, { name: 'y', type: 'bool' }] });
  expect(() => feed.encode(1, { x: [1, 256], y: true })).toThrow('x: 256 does not fit u8');
  expect(() => feed.encode(1, { x: [1, 1.5], y: true })).toThrow('x: expected an integer for u8');
  expect(() => feed.encode(1, { x: [1], y: true })).toThrow('x: expected 2 × u8');
  expect(() => feed.encode(1, { x: [1, 2], y: 1 as never })).toThrow('y: expected a boolean');
  expect(() => feed.encode(-1, { x: [1, 2], y: true })).toThrow('sequence');
  const data = feed.encode(1, { x: [1, 2], y: false });
  expect(() => feed.decode(data, admin)).toThrow('not owned by the feed program');
  expect(() => feed.decode(data.subarray(1), program)).toThrow('size does not match');
});
