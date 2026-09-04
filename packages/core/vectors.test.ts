import { expect, test } from 'bun:test';
import vectors from '../../doppler/tests/vectors.json' with { type: 'json' };
import { Feed, HEADER, padded, updateCu } from './index.js';

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], (b) => parseInt(b, 16));
const { admin, seed, program } = vectors;
const price = [
  { name: 'price', type: 'i64' },
  { name: 'conf', type: 'u64' },
  { name: 'expo', type: 'i32' },
] as const;
const value = { price: 17_234_000_000n, conf: 5_000_000n, expo: -8 };

test.each(vectors.programs)('program for $payloadSize bytes matches the Rust emitter', async ({ payloadSize, cu, elf }) => {
  const feed = await Feed.load({ admin, seed, fields: [{ name: 'x', type: 'u8', len: payloadSize }] });
  expect(hex(feed.elf())).toBe(elf);
  expect(updateCu(payloadSize)).toBe(cu);
});

test('the program and the feed address are create_with_seed', async () => {
  const feed = await Feed.load({ admin, seed, fields: price });
  expect(feed.program).toBe(program);
  expect(feed.address).toBe(vectors.feed);
  expect(feed.size).toBe(20);
});

test('price round trips through the wire format with the exact budgets', async () => {
  const feed = await Feed.load({ admin, seed, fields: price });
  const data = feed.encode(vectors.price.sequence, value);
  expect(data.length).toBe(HEADER + padded(20));
  expect(hex(data)).toBe(vectors.price.data);
  expect(feed.decode(fromHex(vectors.price.data), program)).toEqual({ sequence: 5, value });
  expect(feed.updateBudget(1000)).toEqual({
    computeUnits: 25,
    loadedBytes: vectors.price.loadedBytes - 2 * 64 - 22,
    requestedComputeUnits: vectors.price.computeUnits,
    requestedLoadedBytes: vectors.price.loadedBytes,
    lamports: 5_001n,
  });
  expect(feed.updateBudget(0).lamports).toBe(5_000n);
  expect(feed.updateBudget(1_000_000).lamports).toBe(5_000n + BigInt(vectors.price.computeUnits));
  expect(feed.deployBudget(1000)).toEqual({
    computeUnits: 10_080,
    loadedBytes: 8 * 64 + 21 + 37 + 17 + 40,
    requestedComputeUnits: 10_530,
    requestedLoadedBytes: 10 * 64 + 21 + 37 + 17 + 40 + 22,
    lamports: 5_011n,
  });
});

test('every type and arrays round trip', async () => {
  const feed = await Feed.load({
    admin,
    seed,
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
  expect(data.length).toBe(HEADER + 24);
  expect(data[HEADER]).toBe(0xff);
  expect(feed.decode(data, feed.program).value).toEqual(value);
});

test('load rejects bad manifests', async () => {
  const load = (fields: unknown, keys = { admin, seed }) => Feed.load({ ...keys, fields: fields as never });
  await expect(load([{ name: 'x', type: 'u8' }], { admin: 'O' + admin.slice(1), seed })).rejects.toThrow('admin: a key');
  await expect(load([{ name: 'x', type: 'u8' }], { admin, seed: '' })).rejects.toThrow('seed: a seed is 1 to 32 bytes');
  await expect(load([{ name: 'x', type: 'u8' }], { admin, seed: 's'.repeat(33) })).rejects.toThrow('seed: a seed');
  await expect(load([{ name: 'x', type: 'u8' }], { admin, seed: 's'.repeat(32) })).resolves.toBeInstanceOf(Feed);
  await expect(load([])).rejects.toThrow('at least one field');
  await expect(load([{ name: 'bad-name', type: 'u8' }])).rejects.toThrow('identifier');
  await expect(load([{ name: '1st', type: 'u8' }])).rejects.toThrow('identifier');
  await expect(load([{ name: 'x', type: 'u128' }])).rejects.toThrow('x: a field type is one of');
  await expect(load([{ name: 'x', type: 'u8', len: 0 }])).rejects.toThrow('x: a field length');
  await expect(load([{ name: 'x', type: 'u8' }, { name: 'x', type: 'u8' }])).rejects.toThrow('x: a field name must be unique');
});

test('encode and decode reject what does not fit', async () => {
  const feed = await Feed.load({ admin, seed, fields: [{ name: 'x', type: 'u8', len: 2 }, { name: 'y', type: 'bool' }] });
  expect(() => feed.encode(1, { x: [1, 256], y: true })).toThrow('x: 256 does not fit u8');
  expect(() => feed.encode(1, { x: [1, 1.5], y: true })).toThrow('x: expected an integer for u8');
  expect(() => feed.encode(1, { x: [1], y: true })).toThrow('x: expected 2 × u8');
  expect(() => feed.encode(1, { x: [1, 2], y: 1 as never })).toThrow('y: expected a boolean');
  expect(() => feed.encode(-1, { x: [1, 2], y: true })).toThrow('sequence');
  const data = feed.encode(1, { x: [1, 2], y: false });
  expect(() => feed.decode(data, admin)).toThrow('not owned by the feed program');
  expect(() => feed.decode(data.subarray(1), feed.program)).toThrow('size does not match');
});
