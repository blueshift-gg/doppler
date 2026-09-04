// Deploy a Price feed with a fresh program keypair and write its manifest to `target/doppler.json`.
// `RPC_URL` overrides mainnet, for surfpool: `RPC_URL=http://localhost:8899`.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DopplerClient } from '@blueshift-gg/doppler-web3js';
import { Connection, Keypair } from '@solana/web3.js';

const rpc = new Connection(process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com', 'confirmed');
const keys = new URL('../keys/admin-keypair.json', import.meta.url);
const admin = await Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keys, 'utf8'))));
const program = await Keypair.generate();
const doppler = await DopplerClient.load(
  {
    program: program.address,
    admin: admin.address,
    fields: [
      { name: 'price', type: 'i64' },
      { name: 'conf', type: 'u64' },
      { name: 'expo', type: 'i32' },
    ],
  },
  { rpc, unitPrice: 1_000 },
);

const signature = await doppler.deploy().send([admin, program]);
mkdirSync('target', { recursive: true });
writeFileSync('target/doppler.json', JSON.stringify(doppler.manifest, null, 2));
console.log(`program ${program.address} feed ${doppler.address} in ${signature}`);
