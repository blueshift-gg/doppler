# @blueshift-gg/doppler-web3js

Doppler oracle SDK for applications using `@solana/web3.js`.

## Install

```bash
npm install @blueshift-gg/doppler-web3js @solana/web3.js
```

## Usage

```ts
import { Doppler, PriceFeedSerializer, PROGRAM_ID } from "@blueshift-gg/doppler-web3js";
import { Connection, Keypair } from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const signer = Keypair.generate();

const client = new Doppler(connection, signer, {
  programId: PROGRAM_ID,
  admin: signer.publicKey,
});

const oracle = await client.fetchOracle(oracleAddress, new PriceFeedSerializer());

await client.updateOracle(
  oracleAddress,
  {
    sequence: oracle.sequence + 1n,
    payload: { price: 42_000_000n },
  },
  new PriceFeedSerializer(),
  1_000n,
);
```
