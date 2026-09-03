// Write SOL/USD to the feed from `target/doppler.json` and read it back.

import { readFileSync } from 'node:fs';
import { Doppler, type Manifest } from '@blueshift-gg/doppler-kit';
import { createKeyPairSignerFromBytes, createSolanaRpc } from '@solana/kit';

const rpc = createSolanaRpc(process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com');
const keys = new URL('../keys/admin-keypair.json', import.meta.url);
const admin = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(keys, 'utf8'))));
const doppler = await Doppler.load(JSON.parse(readFileSync('target/doppler.json', 'utf8')) as Manifest);

const price = { price: 17_234_000_000n, conf: 5_000_000n, expo: -8 };
const signature = await doppler.update(price).send([admin], { rpc, unitPrice: 1_000 });
console.log(`sent ${signature}`);

const { lastUpdatedMs, value } = await doppler.read(rpc);
console.log(`SOL/USD = ${value.price}e${value.expo} ± ${value.conf}e${value.expo} at ${lastUpdatedMs} ms`);
