# @blueshift-gg/doppler-kit

[Doppler](https://github.com/blueshift-gg/doppler) feeds for `@solana/kit`: load, deploy, update,
read, subscribe.

```ts
import { DopplerClient } from '@blueshift-gg/doppler-kit';

const doppler = await DopplerClient.load(manifest, { rpc, unitPrice: 1_000 });
await doppler.deploy().send([admin, programKeypair]);
await doppler.update(Date.now(), { price: 17_234_000_000n, conf: 5_000_000n, expo: -8 }).send([admin]);
const { sequence, value } = await doppler.read();
for await (const reading of doppler.subscribe(rpcSubscriptions, { signal })) { /* ... */ }
const { instruction, computeUnits, loadedBytes, lamports } = doppler.update(Date.now(), value).instruction();
```

Peer dependencies: `@solana/kit`, `@solana-program/loader-v3`, `@solana-program/system`,
`@solana-program/compute-budget`. The full guide is in the repository README.
