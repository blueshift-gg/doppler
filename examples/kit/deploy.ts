// Deploy a Price feed named ETH/USD and write its manifest to `target/doppler.json`.
// `RPC_URL` overrides mainnet, for surfpool: `RPC_URL=http://localhost:8899`.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DopplerClient } from '@blueshift-gg/doppler-kit';
import { createKeyPairSignerFromBytes, createSolanaRpc } from '@solana/kit';

const rpc = createSolanaRpc(process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com');
const keys = new URL('../keys/admin-keypair.json', import.meta.url);
const admin = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(keys, 'utf8'))));
const doppler = await DopplerClient.load(
  {
    admin: admin.address,
    seed: 'ETH/USD',
    fields: [
      { name: 'price', type: 'i64' },
      { name: 'conf', type: 'u64' },
      { name: 'expo', type: 'i32' },
    ],
  },
  { rpc, unitPrice: 1_000 },
);

for (const signature of await doppler.deploy().send([admin])) console.log(`deploy ${signature}`);
mkdirSync('target', { recursive: true });
writeFileSync('target/doppler.json', JSON.stringify(doppler.manifest, null, 2));
console.log(`program ${doppler.program} feed ${doppler.address}`);
