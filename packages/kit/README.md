# @blueshift-gg/doppler-kit

[Doppler](https://github.com/blueshift-gg/doppler) feeds for `@solana/kit`: load, deploy, update,
read, subscribe.

```ts
import { Doppler } from '@blueshift-gg/doppler-kit';

const doppler = await Doppler.load(manifest);
await doppler.deploy().send([admin, programKeypair], { rpc, unitPrice: 1_000 });
await doppler.update({ price: 17_234_000_000n, conf: 5_000_000n, expo: -8 }).send([admin], { rpc, unitPrice: 1_000 });
const { lastUpdatedMs, value } = await doppler.read(rpc);
for await (const reading of doppler.subscribe(rpcSubscriptions, { signal })) { /* ... */ }
```

Peer dependencies: `@solana/kit`, `@solana-program/loader-v3`, `@solana-program/system`,
`@solana-program/compute-budget`. The full guide is in the repository README.
