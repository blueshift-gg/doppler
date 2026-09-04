import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  AccountRole,
  address,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  generateKeyPairSigner,
  getTransactionEncoder,
  lamports,
  pipe,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from '@solana/kit';
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
  const admin = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(adminKey, 'utf8'))));
  expect(admin.address).toBe(address(vectors.admin));
  const d = await DopplerClient.load({ admin: vectors.admin, seed: vectors.seed, pull: true, fields }, { rpc: noRpc, unitPrice: 1000 });
  const { signed } = await d.update(vectors.price.sequence, value).sign(admin);
  expect(hex(signed)).toBe(vectors.pull.signed);
  const { instruction, budget } = d.pull(signed).instruction();
  expect(instruction.accounts).toEqual([{ address: d.address, role: AccountRole.WRITABLE }]);
  expect(instruction.data).toBe(signed);
  expect(budget.requestedComputeUnits).toBe(vectors.pull.computeUnits);
  expect(budget.requestedLoadedBytes).toBe(vectors.pull.loadedBytes);
  const stranger = await generateKeyPairSigner();
  await expect(d.update(1, value).sign(stranger)).rejects.toThrow(`${admin.address} must sign`);
  await expect(d.pull(signed).send([])).rejects.toThrow('a pull needs a signer to pay');
  const push = await DopplerClient.load({ admin: vectors.admin, seed: vectors.seed, fields }, { rpc: noRpc, unitPrice: 1000 });
  await expect(push.update(1, value).sign(admin)).rejects.toThrow('no pull path');
});

test('a pull deploy packs the program the way the Rust SDK does', async () => {
  const admin = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(adminKey, 'utf8'))));
  const d = await DopplerClient.load({ admin: vectors.admin, seed: vectors.seed, pull: true, fields }, { rpc: noRpc, unitPrice: 0 });
  const deploy = await d.deploy().instructions([admin]);
  const writes = deploy.flatMap(({ instructions }) =>
    instructions
      .filter((ix) => ix.data && ix.data.length > 16 && ix.data[0] === 1 && ix.data[1] === 0 && ix.data[2] === 0 && ix.data[3] === 0)
      .map((ix) => [new DataView(ix.data!.buffer, ix.data!.byteOffset).getUint32(4, true), ix.data!.length - 16]),
  );
  expect(writes).toEqual(vectors.pull.deploy.writes);
  expect(deploy.at(-1)!.instructions.length).toBe(vectors.pull.deploy.finishesInTheLast ? 5 : 4);
  for (const { instructions } of deploy) {
    const message = pipe(
      createTransactionMessage({ version: 'legacy' }),
      (m) => setTransactionMessageFeePayerSigner(admin, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: vectors.feed as Blockhash, lastValidBlockHeight: 0n }, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    expect(getTransactionEncoder().encode(compileTransaction(message)).length + 3 * 12).toBeLessThanOrEqual(1232 + 3 * 12);
  }
  expect(deploy[0]!.budget.computeUnits).toBe(150 + 2 * 2_370);
  expect(deploy[1]!.budget.computeUnits).toBe(2_370);
  expect(deploy[1]!.budget.loadedBytes).toBe(2 * 64 + 37 + d.feed.elf().length + 37);
  expect(deploy.at(-1)!.budget.computeUnits).toBe(2_370 + 2 * 150 + 2 * 2_370 + 150);
});

const url = process.env.DOPPLER_RPC;

test.skipIf(!url)('deploys a pull feed and lands a signed update from a relayer on a live cluster', async () => {
  const rpc = createSolanaRpc(url!);
  const [admin, relayer] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
  const balance = async (who: typeof admin) => (await rpc.getBalance(who.address).send()).value;
  await rpc.requestAirdrop(admin.address, lamports(10_000_000_000n)).send();
  await rpc.requestAirdrop(relayer.address, lamports(1_000_000_000n)).send();
  while ((await balance(admin)) === 0n || (await balance(relayer)) === 0n) await new Promise((r) => setTimeout(r, 200));
  const d = await DopplerClient.load({ admin: admin.address, seed: 'SOL/USD', pull: true, fields }, { rpc, unitPrice: 1 });
  const consumed = async (signature: Parameters<typeof rpc.getTransaction>[0]) =>
    (await rpc.getTransaction(signature, { commitment: 'confirmed', encoding: 'json', maxSupportedTransactionVersion: 0 }).send())?.meta?.computeUnitsConsumed;

  const plan = await d.deploy().instructions([admin]);
  const signatures = await d.deploy().send([admin]);
  expect(signatures.length).toBe(plan.length);
  for (const [i, signature] of signatures.entries()) expect(await consumed(signature)).toBe(BigInt(plan[i]!.budget.requestedComputeUnits));

  const { signed } = await d.update(Date.now(), value).sign(admin);
  const pull = d.pull(signed);
  const funded = await balance(relayer);
  const signature = await pull.send([relayer]);
  expect(funded - (await balance(relayer))).toBe(pull.instruction().budget.lamports);
  const units = await consumed(signature);
  const limit = BigInt(pull.instruction().budget.requestedComputeUnits);
  expect(units! <= limit && units! > limit - 80n).toBe(true);
  expect((await d.read()).value).toEqual(value);
  await expect(d.pull(signed).send([relayer])).resolves.toBeDefined();
}, 300_000);
