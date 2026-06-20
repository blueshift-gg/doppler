# @blueshift-gg/doppler-kit

Doppler oracle SDK for applications using `@solana/kit`.

## Install

```bash
npm install @blueshift-gg/doppler-kit @solana/kit @solana-program/compute-budget @solana-program/system
```

## Usage

```ts
import { Doppler, PriceFeedSerializer, PROGRAM_ID } from "@blueshift-gg/doppler-kit";
import { createSolanaRpc } from "@solana/kit";
import { createKeyPairSignerFromBytes } from "@solana/kit";

const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
const signer = await createKeyPairSignerFromBytes(secretKeyBytes);

const client = new Doppler(rpc, signer, {
  programId: PROGRAM_ID,
  admin: signer.address,
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
