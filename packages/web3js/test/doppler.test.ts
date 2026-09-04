import { expect, test } from 'bun:test';
import { ComputeBudgetProgram, Connection, Keypair, LoaderV3Program, PACKET_DATA_SIZE, PublicKey, Transaction } from '@solana/web3.js';
import vectors from '../../../doppler/tests/vectors.json' with { type: 'json' };
import { HEADER, PROGRAMDATA_HEADER, PROGRAM_LEN, padded, rentExempt } from '../../core/index.js';
import { DopplerClient } from '../src/index.js';

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fields = [
  { name: 'price', type: 'i64' },
  { name: 'conf', type: 'u64' },
  { name: 'expo', type: 'i32' },
] as const;
const value = { price: 17_234_000_000n, conf: 5_000_000n, expo: -8 };
const noRpc = {} as never;

test('the addresses, the update instruction and its budget match the vectors', async () => {
  const d = await DopplerClient.load({ admin: vectors.admin, seed: vectors.seed, fields }, { rpc: noRpc, unitPrice: 1000 });
  expect([d.program.toString(), d.address.toString()]).toEqual([vectors.program, vectors.feed]);
  const { instruction: ix, budget } = d.update(5, value).instruction();
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

test('deploy is one transaction signed by the admin that ends immutable with the feed', async () => {
  const [admin, stranger] = await Promise.all([Keypair.generate(), Keypair.generate()]);
  const d = await DopplerClient.load({ admin: admin.address, seed: 'SOL/USD', fields }, { rpc: noRpc, unitPrice: 1000 });
  const deploy = await d.deploy().instructions();
  expect(deploy.length).toBe(1);
  const { instructions, budget } = deploy[0]!;
  expect(instructions.length).toBe(7);
  expect(instructions[3]!.keys[1]!.pubkey.equals(d.program)).toBe(true);
  expect(instructions[5]!.keys.length).toBe(2);
  expect(instructions[6]!.keys[1]!.pubkey.equals(d.address)).toBe(true);
  expect(budget).toEqual({
    computeUnits: 10_080,
    loadedBytes: 8 * 64 + 21 + 37 + 17 + 40,
    requestedComputeUnits: 10_530,
    requestedLoadedBytes: 10 * 64 + 21 + 37 + 17 + 40 + 22,
    lamports: 5_011n,
  });
  const tx = new Transaction({ feePayer: d.admin, blockhash: vectors.feed as never, lastValidBlockHeight: 0 }).add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    ...instructions,
  );
  const message = tx.compileMessage();
  expect(message.header.numRequiredSignatures).toBe(1);
  expect(1 + 64 + message.serialize().length).toBeLessThanOrEqual(PACKET_DATA_SIZE);
  await expect(d.deploy().send([stranger])).rejects.toThrow(`${admin.publicKey} must sign`);
  await expect(d.update(1, value).send([stranger])).rejects.toThrow(`${admin.publicKey} must sign`);
});

const url = process.env.DOPPLER_RPC;
const ws = process.env.DOPPLER_WS;

test.skipIf(!url || !ws)('deploys, updates, reads and subscribes on a live cluster at the priced budgets', async () => {
  const rpc = new Connection(url!, { wsEndpoint: ws!, commitment: 'confirmed' });
  const admin = await Keypair.generate();
  await rpc.confirmTransaction(await rpc.requestAirdrop(admin.publicKey, 1_000_000_000));
  const d = await DopplerClient.load({ admin: admin.address, seed: 'SOL/USD', fields }, { rpc, unitPrice: 1 });
  const consumed = async (signature: string) =>
    (await rpc.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }))?.meta?.computeUnitsConsumed;

  const funded = await rpc.getBalance(admin.publicKey);
  const { budget } = (await d.deploy().instructions())[0]!;
  const [deploy] = await d.deploy().send([admin]);
  const deployed = await rpc.getBalance(admin.publicKey);
  const rent = rentExempt(PROGRAM_LEN) + rentExempt(PROGRAMDATA_HEADER + d.feed.elf().length) + rentExempt(HEADER + padded(d.feed.size));
  expect(funded - deployed).toBe(budget.lamports + rent);
  expect(await consumed(deploy!)).toBe(BigInt(budget.requestedComputeUnits));
  const [programdata] = await PublicKey.findProgramAddress([d.program.toBytes()], LoaderV3Program.programId);
  const account = await rpc.getAccountInfo(programdata);
  expect([account?.data.length, account?.data[12]]).toEqual([45 + d.feed.elf().length, 0]);

  const controller = new AbortController();
  const readings = d.subscribe({ signal: controller.signal });
  const first = readings.next();
  await new Promise((r) => setTimeout(r, 500));
  const update = d.update(Date.now(), value);
  const signature = await update.send([admin]);
  expect(deployed - (await rpc.getBalance(admin.publicKey))).toBe(update.instruction().budget.lamports);
  expect(await consumed(signature)).toBe(BigInt(update.instruction().budget.requestedComputeUnits));
  const reading = await d.read();
  expect(reading.value).toEqual(value);
  expect(reading.sequence).toBeGreaterThan(1_700_000_000_000);
  expect((await first).value).toEqual(reading);
  controller.abort();
  await expect(d.update(reading.sequence, value).send([admin])).rejects.toThrow();
}, 60_000);
