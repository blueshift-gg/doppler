import { expect, test } from 'bun:test';
import {
  AccountRole,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  fetchEncodedAccount,
  getAddressEncoder,
  getProgramDerivedAddress,
  isTransactionWithinSizeLimit,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from '@solana/kit';
import {
  getSetComputeUnitLimitInstructionDataDecoder,
  getSetComputeUnitPriceInstruction,
  getSetComputeUnitPriceInstructionDataDecoder,
  getSetLoadedAccountsDataSizeLimitInstructionDataDecoder,
} from '@solana-program/compute-budget';
import vectors from '../../../doppler/tests/vectors.json';
import { LOADER_V3_PROGRAM_ADDRESS } from '@solana-program/loader-v3';
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
  expect(d.address).toBe(vectors.feed);
  const ix = d.update(value).instruction();
  expect(ix.programAddress).toBe(vectors.program);
  expect(ix.accounts).toEqual([
    { address: vectors.admin, role: AccountRole.READONLY_SIGNER },
    { address: vectors.feed, role: AccountRole.WRITABLE },
  ]);
  expect(hex(ix.data!.subarray(8))).toBe(vectors.price.data.slice(16));
});

test('instructions carry the exact budget', async () => {
  const d = await Doppler.load({ program: vectors.program, admin: vectors.admin, fields });
  const [price, loaded, limit, update] = d.update(value).instructions({ unitPrice: 1000 });
  expect(getSetComputeUnitPriceInstructionDataDecoder().decode(price!.data!).microLamports).toBe(1000n);
  expect(getSetLoadedAccountsDataSizeLimitInstructionDataDecoder().decode(loaded!.data!).accountDataSizeLimit).toBe(vectors.price.loadedBytes);
  expect(getSetComputeUnitLimitInstructionDataDecoder().decode(limit!.data!).units).toBe(vectors.price.computeUnits);
  expect(update!.programAddress).toBe(vectors.program);
});

test('deploy fits one transaction and ends immutable with the feed', async () => {
  const [admin, program, buffer] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner()]);
  const d = await Doppler.load({ program: program.address, admin: admin.address, fields });
  const [write, deploy] = await d.deploy().instructions([admin, program], buffer);
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
  await expect(d.deploy().send([admin], { rpc: noRpc, unitPrice: 1 })).rejects.toThrow(`${program.address} must sign`);
  await expect(d.update(value).send([program], { rpc: noRpc, unitPrice: 1 })).rejects.toThrow(`${admin.address} must sign`);
});

const url = process.env.DOPPLER_RPC;
const ws = process.env.DOPPLER_WS;

test.skipIf(!url || !ws)('deploys, updates, reads and subscribes on a live cluster', async () => {
  const rpc = createSolanaRpc(url!);
  const rpcSubscriptions = createSolanaRpcSubscriptions(ws!);
  const [admin, program] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
  await rpc.requestAirdrop(admin.address, lamports(1_000_000_000n)).send();
  while ((await rpc.getBalance(admin.address).send()).value === 0n) await new Promise((r) => setTimeout(r, 200));
  const d = await Doppler.load({ program: program.address, admin: admin.address, fields });
  await d.deploy().send([admin, program], { rpc, unitPrice: 1 });
  const [programdata] = await getProgramDerivedAddress({
    programAddress: LOADER_V3_PROGRAM_ADDRESS,
    seeds: [getAddressEncoder().encode(program.address)],
  });
  const deployed = await fetchEncodedAccount(rpc, programdata);
  expect(deployed.exists && [deployed.data.length, deployed.data[12]]).toEqual([45 + d.feed.elf().length, 0]);
  const controller = new AbortController();
  const readings = d.subscribe(rpcSubscriptions, { signal: controller.signal });
  const first = readings.next();
  await new Promise((r) => setTimeout(r, 500));
  const signature = await d.update(value).send([admin], { rpc, unitPrice: 1 });
  const reading = await d.read(rpc);
  expect(reading.value).toEqual(value);
  expect(reading.lastUpdatedMs).toBeGreaterThan(1_700_000_000_000);
  expect((await first).value).toEqual(reading);
  controller.abort();
  const tx = await rpc.getTransaction(signature, { commitment: 'confirmed', encoding: 'json', maxSupportedTransactionVersion: 0 }).send();
  expect(tx?.meta?.computeUnitsConsumed).toBe(BigInt(vectors.price.computeUnits));
  await expect(new Update(d, reading.lastUpdatedMs, value).send([admin], { rpc, unitPrice: 1 })).rejects.toThrow();
}, 60_000);
