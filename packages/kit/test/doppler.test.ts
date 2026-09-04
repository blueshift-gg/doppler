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
import { DopplerClient, Update } from '../src/index.js';

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

test('the address, the update instruction and its budget match the vectors', async () => {
  const d = await DopplerClient.load({ program: vectors.program, admin: vectors.admin, fields }, { rpc: noRpc, unitPrice: 1000 });
  expect(d.address).toBe(feed);
  const { instruction: ix, ...budget } = d.update(5, value).instruction();
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

test('deploy fits one transaction and ends immutable with the feed', async () => {
  const [admin, program] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
  const d = await DopplerClient.load({ program: program.address, admin: admin.address, fields }, { rpc: noRpc, unitPrice: 1 });
  const { write, deploy, buffer } = await d.deploy().instruction([admin, program]);
  expect(write[0]!.accounts![1]!.address).toBe(buffer.address);
  expect([write.length, deploy.length]).toEqual([3, 4]);
  expect(deploy[2]!.accounts!.length).toBe(2);
  expect(deploy[3]!.accounts![1]!.address).toBe(d.address);
  const message = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayerSigner(admin, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: vectors.feed as Blockhash, lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstructions([getSetComputeUnitPriceInstruction({ microLamports: 1 }), ...write, ...deploy], m),
  );
  expect(isTransactionWithinSizeLimit(compileTransaction(message))).toBe(true);
  await expect(d.deploy().send([admin])).rejects.toThrow(`${program.address} must sign`);
  await expect(d.update(1, value).send([program])).rejects.toThrow(`${admin.address} must sign`);
});

const url = process.env.DOPPLER_RPC;
const ws = process.env.DOPPLER_WS;

test.skipIf(!url || !ws)('deploys, updates, reads and subscribes on a live cluster at the priced budget', async () => {
  const rpc = createSolanaRpc(url!);
  const rpcSubscriptions = createSolanaRpcSubscriptions(ws!);
  const [admin, program] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
  const balance = async () => (await rpc.getBalance(admin.address).send()).value;
  await rpc.requestAirdrop(admin.address, lamports(1_000_000_000n)).send();
  while ((await balance()) === 0n) await new Promise((r) => setTimeout(r, 200));
  const d = await DopplerClient.load({ program: program.address, admin: admin.address, fields }, { rpc, unitPrice: 1 });

  await d.deploy().send([admin, program]);
  const deployed = await balance();
  const [programdata] = await getProgramDerivedAddress({
    programAddress: LOADER_V3_PROGRAM_ADDRESS,
    seeds: [getAddressEncoder().encode(program.address)],
  });
  const account = await fetchEncodedAccount(rpc, programdata);
  expect(account.exists && [account.data.length, account.data[12]]).toEqual([45 + d.feed.elf().length, 0]);

  const controller = new AbortController();
  const readings = d.subscribe(rpcSubscriptions, { signal: controller.signal });
  const first = readings.next();
  await new Promise((r) => setTimeout(r, 500));
  const update = d.update(Date.now(), value);
  const signature = await update.send([admin]);
  expect(deployed - (await balance())).toBe(update.instruction().lamports);
  const reading = await d.read();
  expect(reading.value).toEqual(value);
  expect(reading.sequence).toBeGreaterThan(1_700_000_000_000);
  expect((await first).value).toEqual(reading);
  controller.abort();
  const tx = await rpc.getTransaction(signature, { commitment: 'confirmed', encoding: 'json', maxSupportedTransactionVersion: 0 }).send();
  expect(tx?.meta?.computeUnitsConsumed).toBe(BigInt(update.instruction().requestedComputeUnits));
  await expect(new Update(d, reading.sequence, value).send([admin])).rejects.toThrow();
}, 60_000);
