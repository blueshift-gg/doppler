// A pull feed: deploy ETH/USD with the pull path, sign an update off chain as the admin, and land it
// from another key, the relayer, who pays. `RPC_URL` as in deploy.ts.

import { readFileSync } from 'node:fs';
import { DopplerClient } from '@blueshift-gg/doppler-kit';
import { createKeyPairSignerFromBytes, createSolanaRpc, fetchEncodedAccount } from '@solana/kit';

const rpc = createSolanaRpc(process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com');
const key = async (name: string) =>
  createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(new URL(`../keys/${name}-keypair.json`, import.meta.url), 'utf8'))));
const [admin, relayer] = await Promise.all([key('admin'), key('relayer')]);
const doppler = await DopplerClient.load(
  {
    admin: admin.address,
    seed: 'ETH/USD pull',
    pull: true,
    fields: [
      { name: 'price', type: 'i64' },
      { name: 'conf', type: 'u64' },
      { name: 'expo', type: 'i32' },
    ],
  },
  { rpc, unitPrice: 1_000 },
);

if (!(await fetchEncodedAccount(rpc, doppler.address)).exists) {
  for (const signature of await doppler.deploy().send([admin])) console.log(`deploy ${signature}`);
}

// The admin's side: sign, and publish the bytes wherever relayers fetch them.
const { signed } = await doppler.update(Date.now(), { price: 3_412_000_000n, conf: 1_000_000n, expo: -8 }).sign(admin);

// The relayer's side: the bytes and a key that pays.
const signature = await doppler.pull(signed).send([relayer]);
console.log(`pulled in ${signature}`);

const { sequence, value } = await doppler.read();
console.log(`${doppler.manifest.seed} = ${value.price}e${value.expo} ± ${value.conf}e${value.expo} at ${sequence} ms`);
