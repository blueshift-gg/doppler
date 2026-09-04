import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Connection, Keypair, PACKET_DATA_SIZE, Transaction } from '@solana/web3.js';
import vectors from '../../../doppler/tests/vectors.json' with { type: 'json' };
import { DopplerClient } from '../src/index.js';

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fields = [
  { name: 'price', type: 'i64' },
  { name: 'conf', type: 'u64' },
  { name: 'expo', type: 'i32' },
] as const;
const value = { price: 17_234_000_000n, conf: 5_000_000n, expo: -8 };
const noRpc = {} as never;
const adminKey = new URL('../../../examples/keys/admin-keypair.json', import.meta.url);

test('sign reproduces the vectors, and pull takes the bytes back', async () => {
  const admin = await Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(adminKey, 'utf8'))));
  expect(String(admin.address)).toBe(vectors.admin);
  const d = await DopplerClient.load({ admin: vectors.admin, seed: vectors.seed, pull: true, fields }, { rpc: noRpc, unitPrice: 1000 });
  const { signed } = await d.update(vectors.price.sequence, value).sign(admin);
  expect(hex(signed)).toBe(vectors.pull.signed);
  const { instruction, budget } = d.pull(signed).instruction();
  expect(instruction.keys.map((k) => [k.pubkey.toString(), k.isSigner, k.isWritable])).toEqual([[vectors.feed, false, true]]);
  expect(instruction.data).toBe(signed);
  expect(budget.requestedComputeUnits).toBe(vectors.pull.computeUnits);
  expect(budget.requestedLoadedBytes).toBe(vectors.pull.loadedBytes);
  await expect(d.update(1, value).sign(await Keypair.generate())).rejects.toThrow(`${admin.publicKey} must sign`);
  await expect(d.pull(signed).send([])).rejects.toThrow('a pull needs a signer to pay');
});

test('a pull deploy packs the program the way the Rust SDK does', async () => {
  const d = await DopplerClient.load({ admin: vectors.admin, seed: vectors.seed, pull: true, fields }, { rpc: noRpc, unitPrice: 0 });
  const deploy = await d.deploy().instructions();
  const writes = deploy.flatMap(({ instructions }) =>
    instructions
      .filter((ix) => ix.data.length > 16 && ix.data[0] === 1 && ix.data[1] === 0 && ix.data[2] === 0 && ix.data[3] === 0)
      .map((ix) => [new DataView(ix.data.buffer, ix.data.byteOffset).getUint32(4, true), ix.data.length - 16]),
  );
  expect(writes).toEqual(vectors.pull.deploy.writes);
  expect(deploy.at(-1)!.instructions.length).toBe(vectors.pull.deploy.finishesInTheLast ? 5 : 4);
  for (const { instructions } of deploy) {
    const tx = new Transaction({ feePayer: d.admin, blockhash: vectors.feed as never, lastValidBlockHeight: 0 }).add(...instructions);
    expect(1 + 64 + tx.compileMessage().serialize().length).toBeLessThanOrEqual(PACKET_DATA_SIZE);
  }
  expect(deploy[1]!.budget.loadedBytes).toBe(2 * 64 + 37 + d.feed.elf().length + 37);
});

const url = process.env.DOPPLER_RPC;
const ws = process.env.DOPPLER_WS;

test.skipIf(!url || !ws)('deploys a pull feed and lands a signed update from a relayer on a live cluster', async () => {
  const rpc = new Connection(url!, { wsEndpoint: ws!, commitment: 'confirmed' });
  const [admin, relayer] = await Promise.all([Keypair.generate(), Keypair.generate()]);
  await rpc.confirmTransaction(await rpc.requestAirdrop(admin.publicKey, 10_000_000_000));
  await rpc.confirmTransaction(await rpc.requestAirdrop(relayer.publicKey, 1_000_000_000));
  const d = await DopplerClient.load({ admin: admin.address, seed: 'SOL/USD', pull: true, fields }, { rpc, unitPrice: 1 });
  const consumed = async (signature: string) =>
    (await rpc.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }))?.meta?.computeUnitsConsumed;

  const plan = await d.deploy().instructions();
  const signatures = await d.deploy().send([admin]);
  expect(signatures.length).toBe(plan.length);
  for (const [i, signature] of signatures.entries()) expect(await consumed(signature)).toBe(BigInt(plan[i]!.budget.requestedComputeUnits));

  const { signed } = await d.update(Date.now(), value).sign(admin);
  const pull = d.pull(signed);
  const funded = await rpc.getBalance(relayer.publicKey);
  const signature = await pull.send([relayer]);
  expect(BigInt(funded - (await rpc.getBalance(relayer.publicKey)))).toBe(pull.instruction().budget.lamports);
  const units = await consumed(signature);
  const limit = BigInt(pull.instruction().budget.requestedComputeUnits);
  expect(units! <= limit && units! > limit - 80n).toBe(true);
  expect((await d.read()).value).toEqual(value);
}, 300_000);
