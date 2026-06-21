# @blueshift-gg/doppler-web3js

Doppler oracle SDK for applications using `@solana/web3.js`.

## Install

```bash
npm install @blueshift-gg/doppler-web3js @blueshift-gg/doppler-common @solana/web3.js
```

## Usage

```ts
import { Doppler } from "@blueshift-gg/doppler-web3js";
import { priceFeedCodec } from "@blueshift-gg/doppler-common";
import { Connection, Keypair, Transaction } from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const signer = Keypair.fromSecretKey(secretKeyBytes);
const programId = "11111111111111111111111111111111";

const client = new Doppler(connection, {
  programId,
  admin: signer.publicKey,
  payloadCodec: priceFeedCodec,
});

const { oraclePubkey, instruction: createInstruction } = await client.createOracleAccount(
  "my-oracle",
  signer.publicKey,
);

const updateInstructions = client.createUpdateInstructions(
  [
    {
      oraclePubkey,
      oracle: {
        sequence: 1n,
        payload: { price: 42_000_000n },
      },
    },
  ],
  1_000n,
);

const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
const transaction = new Transaction({
  feePayer: signer.publicKey,
  blockhash,
  lastValidBlockHeight,
}).add(createInstruction, ...updateInstructions);

await transaction.sign(signer);
await connection.sendRawTransaction(await transaction.serialize());

const oracle = await client.fetchOracle(oraclePubkey);

const subscription = client.subscribeToOracle(oraclePubkey);
for await (const update of subscription.notifications) {
  console.log(update.payload.price);
}

await subscription.unsubscribe();
```
