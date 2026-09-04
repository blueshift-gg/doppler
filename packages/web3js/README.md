# @blueshift-gg/doppler-web3js

[Doppler](https://github.com/blueshift-gg/doppler) feeds for `@solana/web3.js` 3: load, deploy,
update, read, subscribe.

```ts
import { Doppler } from '@blueshift-gg/doppler-web3js';

const doppler = await Doppler.load(manifest);
await doppler.deploy().send([admin, programKeypair], { rpc: connection, unitPrice: 1_000 });
await doppler.update(Date.now(), { price: 17_234_000_000n, conf: 5_000_000n, expo: -8 }).send([admin], { rpc: connection, unitPrice: 1_000 });
const { sequence, value } = await doppler.read(connection);
for await (const reading of doppler.subscribe(connection, { signal })) { /* ... */ }
```

Peer dependency: `@solana/web3.js` 3.0.0-rc.3 or newer. The full guide is in the repository README.
