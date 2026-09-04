// Write SOL/USD to the feed from `target/doppler.json` and read it back.

import { readFileSync } from 'node:fs';
import { DopplerClient, type Manifest } from '@blueshift-gg/doppler-web3js';
import { Connection, Keypair } from '@solana/web3.js';

const rpc = new Connection(process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com', 'confirmed');
const keys = new URL('../keys/admin-keypair.json', import.meta.url);
const admin = await Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keys, 'utf8'))));
const doppler = await DopplerClient.load(JSON.parse(readFileSync('target/doppler.json', 'utf8')) as Manifest, { rpc, unitPrice: 1_000 });

const price = { price: 17_234_000_000n, conf: 5_000_000n, expo: -8 };
const signature = await doppler.update(Date.now(), price).send([admin]);
console.log(`sent ${signature}`);

const { sequence, value } = await doppler.read();
console.log(`SOL/USD = ${value.price}e${value.expo} ± ${value.conf}e${value.expo} at ${sequence} ms`);
