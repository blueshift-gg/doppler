# @blueshift-gg/doppler-web3js

Doppler oracle SDK for applications using `@solana/web3.js`.

## Install

```bash
bun add @blueshift-gg/doppler-web3js @solana/web3.js
```

## Usage

```ts
import {
  Doppler,
  PriceFeedSerializer,
  PROGRAM_ID,
} from "@blueshift-gg/doppler-web3js";
import { Connection, Keypair } from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const signer = Keypair.generate();

const client = new Doppler(connection, signer, {
  programId: PROGRAM_ID,
});

const oracle = await client.fetchOracle(oracleAddress, new PriceFeedSerializer());
```
