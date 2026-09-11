# @blueshift-gg/doppler-kit

[Doppler](https://github.com/blueshift-gg/doppler) feeds for `@solana/kit`: load, deploy, update,
read, subscribe.

```ts
import { DopplerClient } from '@blueshift-gg/doppler-kit';

const doppler = await DopplerClient.load({ admin, seed: 'SOL/USD', fields }, { rpc, unitPrice: 1_000 });
await doppler.deploy().send([admin]);
await doppler.update(Date.now(), { price: 17_234_000_000n, conf: 5_000_000n, expo: -8 }).send([admin]);
const { sequence, value } = await doppler.read();
for await (const reading of doppler.subscribe(rpcSubscriptions, { signal })) { /* ... */ }
const { instruction, budget } = doppler.update(Date.now(), value).instruction();
const { instructions } = await doppler.deploy().instructions([admin]);
```

Peer dependencies: `@solana/kit`, `@solana-program/loader-v3`, `@solana-program/system`,
`@solana-program/compute-budget`. The full guide is in the repository README.
