import { expect, test } from 'bun:test';
import { ComputeBudgetProgram, Connection, Keypair, LoaderV3Program, PACKET_DATA_SIZE, PublicKey, Transaction } from '@solana/web3.js';
import vectors from '../../../doppler/tests/vectors.json' with { type: 'json' };
import { DopplerClient, Update } from '../src/index.js';

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fields = [
  { name: 'price', type: 'i64' },
  { name: 'conf', type: 'u64' },
  { name: 'expo', type: 'i32' },
] as const;
const value = { price: 17_234_000_000n, conf: 5_000_000n, expo: -8 };
const noRpc = {} as never;

test('the address, the update instruction and its budget match the vectors', async () => {
  const d = await DopplerClient.load({ program: vectors.program, admin: vectors.admin, fields }, { rpc: noRpc, unitPrice: 1000 });
  expect(d.address.toString()).toBe(vectors.feed);
  const { instruction: ix, ...budget } = d.update(5, value).instruction();
  expect(ix.programId.toString()).toBe(vectors.program);
  expect(ix.keys.map((k) => [k.pubkey.toString(), k.isSigner, k.isWritable])).toEqual([
    [vectors.admin, true, false],
    [vectors.feed, false, true],
  ]);
  expect(hex(ix.data.subarray(8))).toBe(vectors.price.data.slice(16));
  expect(budget).toEqual({
    computeUnits: 25,
    loadedBytes: vectors.price.loadedBytes - 2 * 64 - 22,
    requestedComputeUnits: vectors.price.computeUnits,
    requestedLoadedBytes: vectors.price.loadedBytes,
    lamports: 5_001n,
  });
});

test('deploy fits one transaction and ends immutable with the feed', async () => {
  const [admin, program] = await Promise.all([Keypair.generate(), Keypair.generate()]);
  const d = await DopplerClient.load({ program: program.address, admin: admin.address, fields }, { rpc: noRpc, unitPrice: 1 });
  const { write, deploy, buffer } = await d.deploy().instruction();
  expect(write[0]!.keys[1]!.pubkey.equals(buffer.publicKey)).toBe(true);
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
  await expect(d.deploy().send([admin])).rejects.toThrow(`${program.publicKey} must sign`);
  await expect(d.update(1, value).send([program])).rejects.toThrow(`${admin.publicKey} must sign`);
});

const url = process.env.DOPPLER_RPC;
const ws = process.env.DOPPLER_WS;

test.skipIf(!url || !ws)('deploys, updates, reads and subscribes on a live cluster at the priced budget', async () => {
  const rpc = new Connection(url!, { wsEndpoint: ws!, commitment: 'confirmed' });
  const [admin, program] = await Promise.all([Keypair.generate(), Keypair.generate()]);
  await rpc.confirmTransaction(await rpc.requestAirdrop(admin.publicKey, 1_000_000_000));
  const d = await DopplerClient.load({ program: program.address, admin: admin.address, fields }, { rpc, unitPrice: 1 });

  await d.deploy().send([admin, program]);
  const deployed = await rpc.getBalance(admin.publicKey);
  const [programdata] = await PublicKey.findProgramAddress([program.publicKey.toBytes()], LoaderV3Program.programId);
  const account = await rpc.getAccountInfo(programdata);
  expect([account?.data.length, account?.data[12]]).toEqual([45 + d.feed.elf().length, 0]);

  const controller = new AbortController();
  const readings = d.subscribe({ signal: controller.signal });
  const first = readings.next();
  await new Promise((r) => setTimeout(r, 500));
  const update = d.update(Date.now(), value);
  const signature = await update.send([admin]);
  expect(deployed - (await rpc.getBalance(admin.publicKey))).toBe(update.instruction().lamports);
  const reading = await d.read();
  expect(reading.value).toEqual(value);
  expect(reading.sequence).toBeGreaterThan(1_700_000_000_000);
  expect((await first).value).toEqual(reading);
  controller.abort();
  const tx = await rpc.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  expect(tx?.meta?.computeUnitsConsumed).toBe(BigInt(update.instruction().requestedComputeUnits));
  await expect(new Update(d, reading.sequence, value).send([admin])).rejects.toThrow();
}, 60_000);
