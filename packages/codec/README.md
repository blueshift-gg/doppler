# @blueshift-gg/doppler-codec

Payload schema and codec helpers for Doppler oracle clients.

## Install

```bash
npm install @blueshift-gg/doppler-codec
```

## Usage

```ts
import { buildPayloadCodec } from "@blueshift-gg/doppler-codec";

const payloadCodec = buildPayloadCodec({
  price: "u64",
  confidence: "u32",
});

const encoded = payloadCodec.encode({ price: 42_000_000n, confidence: 125 });
const decoded = payloadCodec.decode(encoded);
```
