import { expect, test } from 'bun:test';
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  fetchEncodedAccount,
  generateKeyPairSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  isTransactionWithinSizeLimit,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from '@solana/kit';
import { getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import { LOADER_V3_PROGRAM_ADDRESS } from '@solana-program/loader-v3';
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
const program = address(vectors.program);
const admin = address(vectors.admin);
const feed = address(vectors.feed);

test('the addresses, the update instruction and its budget match the vectors', async () => {
  const d = await DopplerClient.load({ admin: vectors.admin, seed: vectors.seed, fields }, { rpc: noRpc, unitPrice: 1000 });
  expect([d.program, d.address]).toEqual([program, feed]);
  const { instruction: ix, budget } = d.update(5, value).instruction();
  expect(ix.programAddress).toBe(program);
  expect(ix.accounts).toEqual([
    { address: admin, role: AccountRole.READONLY_SIGNER },
    { address: feed, role: AccountRole.WRITABLE },
  ]);
  expect(hex(ix.data!.subarray(8))).toBe(vectors.price.data.slice(16));
  expect(budget).toEqual({
    computeUnits: 25,
    loadedBytes: vectors.price.loadedBytes - 2 * 64 - 22,
    requestedComputeUnits: vectors.price.computeUnits,
    requestedLoadedBytes: vectors.price.loadedBytes,
    lamports: 5_001n,
  });
});

test('deploy is one transaction signed by the admin that ends immutable with the feed', async () => {
  const [admin, stranger] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
  const d = await DopplerClient.load({ admin: admin.address, seed: 'SOL/USD', fields }, { rpc: noRpc, unitPrice: 1000 });
  const deploy = await d.deploy().instructions([admin]);
  expect(deploy.length).toBe(1);
  const { instructions, budget } = deploy[0]!;
  expect(instructions.length).toBe(7);
  expect(instructions[3]!.accounts![1]!.address).toBe(d.program);
  expect(instructions[5]!.accounts!.length).toBe(2);
  expect(instructions[6]!.accounts![1]!.address).toBe(d.address);
  expect(budget).toEqual({
    computeUnits: 10_080,
    loadedBytes: 8 * 64 + 21 + 37 + 17 + 40,
    requestedComputeUnits: 10_530,
    requestedLoadedBytes: 10 * 64 + 21 + 37 + 17 + 40 + 22,
    lamports: 5_011n,
  });
  const message = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayerSigner(admin, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: vectors.feed as Blockhash, lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstructions([getSetComputeUnitPriceInstruction({ microLamports: 1 }), ...instructions], m),
  );
  const transaction = compileTransaction(message);
  expect(Object.keys(transaction.signatures).length).toBe(1);
  expect(isTransactionWithinSizeLimit(transaction)).toBe(true);
  await expect(d.deploy().send([stranger])).rejects.toThrow(`${admin.address} must sign`);
  await expect(d.update(1, value).send([stranger])).rejects.toThrow(`${admin.address} must sign`);
});

const url = process.env.DOPPLER_RPC;
const ws = process.env.DOPPLER_WS;

test.skipIf(!url || !ws)('deploys, updates, reads and subscribes on a live cluster at the priced budgets', async () => {
  const rpc = createSolanaRpc(url!);
  const rpcSubscriptions = createSolanaRpcSubscriptions(ws!);
  const admin = await generateKeyPairSigner();
  const balance = async () => (await rpc.getBalance(admin.address).send()).value;
  await rpc.requestAirdrop(admin.address, lamports(1_000_000_000n)).send();
  while ((await balance()) === 0n) await new Promise((r) => setTimeout(r, 200));
  const d = await DopplerClient.load({ admin: admin.address, seed: 'SOL/USD', fields }, { rpc, unitPrice: 1 });
  const consumed = async (signature: Parameters<typeof rpc.getTransaction>[0]) =>
    (await rpc.getTransaction(signature, { commitment: 'confirmed', encoding: 'json', maxSupportedTransactionVersion: 0 }).send())?.meta?.computeUnitsConsumed;

  const funded = await balance();
  const { budget } = (await d.deploy().instructions([admin]))[0]!;
  const [deploy] = await d.deploy().send([admin]);
  const deployed = await balance();
  const rent = rentExempt(PROGRAM_LEN) + rentExempt(PROGRAMDATA_HEADER + d.feed.elf().length) + rentExempt(HEADER + padded(d.feed.size));
  expect(funded - deployed).toBe(budget.lamports + rent);
  expect(await consumed(deploy!)).toBe(BigInt(budget.requestedComputeUnits));
  const [programdata] = await getProgramDerivedAddress({ programAddress: LOADER_V3_PROGRAM_ADDRESS, seeds: [getAddressEncoder().encode(d.program)] });
  const account = await fetchEncodedAccount(rpc, programdata);
  expect(account.exists && [account.data.length, account.data[12]]).toEqual([45 + d.feed.elf().length, 0]);

  const controller = new AbortController();
  const readings = d.subscribe(rpcSubscriptions, { signal: controller.signal });
  const first = readings.next();
  await new Promise((r) => setTimeout(r, 500));
  const update = d.update(Date.now(), value);
  const signature = await update.send([admin]);
  expect(deployed - (await balance())).toBe(update.instruction().budget.lamports);
  expect(await consumed(signature)).toBe(BigInt(update.instruction().budget.requestedComputeUnits));
  const reading = await d.read();
  expect(reading.value).toEqual(value);
  expect(reading.sequence).toBeGreaterThan(1_700_000_000_000);
  expect((await first).value).toEqual(reading);
  controller.abort();
  await expect(d.update(reading.sequence, value).send([admin])).rejects.toThrow();
}, 60_000);
