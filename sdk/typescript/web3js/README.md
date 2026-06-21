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
import { Connection, Keypair, Transaction } from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const signer = Keypair.fromSecretKey(secretKeyBytes);

const client = new Doppler(connection, {
  programId: PROGRAM_ID,
  admin: signer.publicKey,
});

const oracle = await client.fetchOracle(oracleAddress, priceFeedCodec);

const subscription = client.subscribeToOracle(oracleAddress, priceFeedCodec);
for await (const update of subscription.notifications) {
  console.log(update.payload.price);
}

await subscription.unsubscribe();

const instructions = client.createUpdateInstructions(
  [
    {
      oraclePubkey: oracleAddress,
      oracle: {
        sequence: oracle.sequence + 1n,
        payload: { price: 42_000_000n },
      },
      payloadCodec: priceFeedCodec,
    },
  ],
  1_000n,
);

const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
const transaction = new Transaction({
  feePayer: signer.publicKey,
  blockhash,
  lastValidBlockHeight,
}).add(...instructions);

await transaction.sign(signer);
await connection.sendRawTransaction(await transaction.serialize());
```
