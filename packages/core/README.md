# @blueshift-gg/doppler

The core of a [Doppler](https://github.com/blueshift-gg/doppler) feed, with no dependencies: the
manifest, the payload codec, the wire format, the budget, and the program generator that emits the
21 CU sBPF v3 program with your admin key in the bytecode.

```ts
import { Feed } from '@blueshift-gg/doppler';

const feed = await Feed.load(manifest);      // validates, derives the feed address
feed.elf();                                  // the program, 360 bytes for a Price
feed.budget();                               // { computeUnits: 475, loadedBytes: 811 }
feed.encode(Date.now(), { price: 1n, conf: 0n, expo: -8 });
feed.decode(account.data, account.owner);    // { lastUpdatedMs, value }
```

Clients: [`@blueshift-gg/doppler-kit`](https://www.npmjs.com/package/@blueshift-gg/doppler-kit) and
[`@blueshift-gg/doppler-web3js`](https://www.npmjs.com/package/@blueshift-gg/doppler-web3js).
