# @blueshift-gg/doppler-web3js

Doppler oracle SDK for applications using `@solana/web3.js`.

## Install

```bash
npm install @blueshift-gg/doppler-web3js @solana/web3.js
```

## Usage

```ts
import { Doppler } from "@blueshift-gg/doppler-web3js";
import { priceFeedCodec, PROGRAM_ID } from "@blueshift-gg/doppler-common";
import { Connection, Keypair } from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const signer = Keypair.fromSecretKey(secretKeyBytes);

const client = new Doppler(connection, signer, {
  programId: PROGRAM_ID,
  admin: signer.publicKey,
});

const oracle = await client.fetchOracle(oracleAddress, priceFeedCodec);

const subscription = client.subscribeToOracle(oracleAddress, priceFeedCodec);
for await (const update of subscription.notifications) {
  console.log(update.payload.price);
}

await subscription.unsubscribe();

await client.updateOracle(
  oracleAddress,
  {
    sequence: oracle.sequence + 1n,
    payload: { price: 42_000_000n },
  },
  priceFeedCodec,
  1_000n,
);
```
