# @blueshift-gg/doppler-web3js

[Doppler](https://github.com/blueshift-gg/doppler) feeds for `@solana/web3.js` 3: load, deploy,
update, read, subscribe.

```ts
import { DopplerClient } from '@blueshift-gg/doppler-web3js';

const doppler = await DopplerClient.load(manifest, { rpc: connection, unitPrice: 1_000 });
await doppler.deploy().send([admin, programKeypair]);
await doppler.update(Date.now(), { price: 17_234_000_000n, conf: 5_000_000n, expo: -8 }).send([admin]);
const { sequence, value } = await doppler.read();
for await (const reading of doppler.subscribe({ signal })) { /* ... */ }
const { instruction, computeUnits, loadedBytes, lamports } = doppler.update(Date.now(), value).instruction();
```

Peer dependency: `@solana/web3.js` 3.0.0-rc.3 or newer. The full guide is in the repository README.
