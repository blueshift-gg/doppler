# @blueshift-gg/doppler-kit

Doppler oracle SDK for applications using `@solana/kit`.

## Install

```bash
npm install @blueshift-gg/doppler-kit @solana/kit @solana-program/compute-budget @solana-program/system
```

## Usage

```ts
import { Doppler } from "@blueshift-gg/doppler-kit";
import { priceFeedCodec, PROGRAM_ID } from "@blueshift-gg/doppler-common";
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";

const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
const rpcSubscriptions = createSolanaRpcSubscriptions("wss://api.mainnet-beta.solana.com");
const signer = await createKeyPairSignerFromBytes(secretKeyBytes);

const client = new Doppler(rpc, rpcSubscriptions, {
  programId: PROGRAM_ID,
  admin: signer.address,
});

const oracle = await client.fetchOracle(oracleAddress, priceFeedCodec);

const subscription = await client.subscribeToOracle(oracleAddress, priceFeedCodec);
for await (const update of subscription.notifications) {
  console.log(update.payload.price);
}

subscription.unsubscribe();

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

const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
const transactionMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (message) => setTransactionMessageFeePayerSigner(signer, message),
  (message) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
  (message) => appendTransactionMessageInstructions(instructions, message),
);

const transaction = await signTransactionMessageWithSigners(transactionMessage);
```
