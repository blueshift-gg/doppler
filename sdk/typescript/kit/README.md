# @blueshift-gg/doppler-kit

Doppler oracle SDK for applications using `@solana/kit`.

## Install

```bash
npm install @blueshift-gg/doppler-kit @solana/kit @solana-program/compute-budget @solana-program/system
```

## Usage

```ts
import { Doppler, buildPayloadCodec } from "@blueshift-gg/doppler-kit";
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
const programId = "11111111111111111111111111111111";
const payloadCodec = buildPayloadCodec({
  price: "u64",
});

const client = new Doppler(rpc, rpcSubscriptions, {
  programId,
  admin: signer.address,
  payloadCodec,
});

const { oraclePubkey, instruction: createInstruction } = await client.createOracleAccount(
  "my-oracle",
  signer,
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

const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
const transactionMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (message) => setTransactionMessageFeePayerSigner(signer, message),
  (message) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
  (message) =>
    appendTransactionMessageInstructions([createInstruction, ...updateInstructions], message),
);

await signTransactionMessageWithSigners(transactionMessage);

const oracle = await client.fetchOracle(oraclePubkey);

const subscription = await client.subscribeToOracle(oraclePubkey);
for await (const update of subscription.notifications) {
  console.log(update.payload.price);
}

subscription.unsubscribe();
```
