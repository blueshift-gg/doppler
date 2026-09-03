import { expect, test } from 'bun:test';
import { ComputeBudgetProgram, Connection, Keypair, LoaderV3Program, PACKET_DATA_SIZE, PublicKey, Transaction } from '@solana/web3.js';
import vectors from '../../../doppler/tests/vectors.json';
import { Doppler, Update } from '../src/index.js';

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fields = [
  { name: 'price', type: 'i64' },
  { name: 'conf', type: 'u64' },
  { name: 'expo', type: 'i32' },
] as const;
const value = { price: 17_234_000_000n, conf: 5_000_000n, expo: -8 };
const noRpc = {} as never;

test('the address and the update instruction match the vectors', async () => {
  const d = await Doppler.load({ program: vectors.program, admin: vectors.admin, fields });
  expect(d.address.toString()).toBe(vectors.feed);
  const ix = d.update(value).instruction();
  expect(ix.programId.toString()).toBe(vectors.program);
  expect(ix.keys.map((k) => [k.pubkey.toString(), k.isSigner, k.isWritable])).toEqual([
    [vectors.admin, true, false],
    [vectors.feed, false, true],
  ]);
  expect(hex(ix.data.subarray(8))).toBe(vectors.price.data.slice(16));
});

test('instructions carry the exact budget', async () => {
  const d = await Doppler.load({ program: vectors.program, admin: vectors.admin, fields });
  const [price, loaded, limit, update] = d.update(value).instructions({ unitPrice: 1000 });
  const view = (ix: { data: Uint8Array }) => new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength);
  expect([price!.data[0], view(price!).getBigUint64(1, true)]).toEqual([3, 1000n]);
  expect([loaded!.data[0], view(loaded!).getUint32(1, true)]).toEqual([4, vectors.price.loadedBytes]);
  expect([limit!.data[0], view(limit!).getUint32(1, true)]).toEqual([2, vectors.price.computeUnits]);
  expect(update!.programId.toString()).toBe(vectors.program);
});

test('deploy fits one transaction and ends immutable with the feed', async () => {
  const [admin, program, buffer] = await Promise.all([Keypair.generate(), Keypair.generate(), Keypair.generate()]);
  const d = await Doppler.load({ program: program.address, admin: admin.address, fields });
  const [write, deploy] = await d.deploy().instructions(buffer.publicKey);
  expect([write.length, deploy.length]).toEqual([3, 4]);
  expect(deploy[2]!.keys.length).toBe(2);
  expect(deploy[3]!.keys[1]!.pubkey.equals(d.address)).toBe(true);
  const tx = new Transaction({ feePayer: d.admin, blockhash: vectors.feed as never, lastValidBlockHeight: 0 }).add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    ...write,
    ...deploy,
  );
  const message = tx.compileMessage();
  expect(message.header.numRequiredSignatures).toBe(3);
  expect(1 + 64 * 3 + message.serialize().length).toBeLessThanOrEqual(PACKET_DATA_SIZE);
  await expect(d.deploy().send([admin], { rpc: noRpc, unitPrice: 1 })).rejects.toThrow(`${program.publicKey} must sign`);
  await expect(d.update(value).send([program], { rpc: noRpc, unitPrice: 1 })).rejects.toThrow(`${admin.publicKey} must sign`);
});

const url = process.env.DOPPLER_RPC;
const ws = process.env.DOPPLER_WS;

test.skipIf(!url || !ws)('deploys, updates, reads and subscribes on a live cluster', async () => {
  const rpc = new Connection(url!, { wsEndpoint: ws, commitment: 'confirmed' });
  const [admin, program] = await Promise.all([Keypair.generate(), Keypair.generate()]);
  await rpc.confirmTransaction(await rpc.requestAirdrop(admin.publicKey, 1_000_000_000));
  const d = await Doppler.load({ program: program.address, admin: admin.address, fields });
  await d.deploy().send([admin, program], { rpc, unitPrice: 1 });
  const [programdata] = await PublicKey.findProgramAddress([program.publicKey.toBytes()], LoaderV3Program.programId);
  const deployed = await rpc.getAccountInfo(programdata);
  expect([deployed?.data.length, deployed?.data[12]]).toEqual([45 + d.feed.elf().length, 0]);
  const controller = new AbortController();
  const readings = d.subscribe(rpc, { signal: controller.signal });
  const first = readings.next();
  await new Promise((r) => setTimeout(r, 500));
  const signature = await d.update(value).send([admin], { rpc, unitPrice: 1 });
  const reading = await d.read(rpc);
  expect(reading.value).toEqual(value);
  expect(reading.lastUpdatedMs).toBeGreaterThan(1_700_000_000_000);
  expect((await first).value).toEqual(reading);
  controller.abort();
  const tx = await rpc.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  expect(tx?.meta?.computeUnitsConsumed).toBe(BigInt(vectors.price.computeUnits));
  await expect(new Update(d, reading.lastUpdatedMs, value).send([admin], { rpc, unitPrice: 1 })).rejects.toThrow();
}, 60_000);
