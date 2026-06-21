# @blueshift-gg/doppler

Programmatic APIs for payload schema validation, bytecode generation, manifest creation, SDK rendering, and Loader v3 deploy transaction construction.

## Get Started

```sh
npm install @blueshift-gg/doppler
```

## Workflow

```ts
import {
  buildDeployTransactions,
  createDopplerArtifacts,
  createGeneratorConfig,
  renderPayloadCodecSdk,
  renderRustSdk,
} from "@blueshift-gg/doppler";
import { Connection } from "@solana/web3.js";

const config = createGeneratorConfig({
  name: "doppler",
  programId: "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm",
  admin: "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE",
  arch: "v3",
  payload: {
    price: "u64",
    confidence: "u32",
    slot: "u64",
  },
});

const { assembly, bytecode, manifest } = await createDopplerArtifacts(config);

const codecFiles = renderPayloadCodecSdk(config);
const rustFiles = await renderRustSdk(config);

const connection = new Connection("https://api.devnet.solana.com");
const bundle = await buildDeployTransactions({
  connection,
  programId: config.programId,
  payer: "<payer-address>",
  bytecode,
});
```

Each SDK renderer returns `Record<string, string>` (path → source). Core does not write files; callers decide where to persist artifacts.

## Schema and manifest

A generator config requires a fixed-size payload schema:

```ts
const payload = {
  price: "u64",
  confidence: "u32",
  slot: "u64",
} as const;
```

`createGeneratorConfig` normalizes the schema, computes packed little-endian layout offsets, and validates required metadata (`name`, `programId`, `admin`, `arch`).

`createDopplerArtifacts` returns a manifest shaped like:

```json
{
  "name": "doppler",
  "programId": "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm",
  "admin": "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE",
  "arch": "v3",
  "payloadSize": 20,
  "schemaHash": "sha256:...",
  "elfSha256": "sha256:..."
}
```

## Supported Fields

Supported scalar types:

```txt
u8, u16, u32, u64, i8, i16, i32, i64, bool
```

Fixed-size arrays use this form:

```ts
payload: {
  authority: { type: "u8", length: 32 },
}
```

The generated payload layout is packed and little-endian. There is no Rust `repr(C)` padding. Dynamic fields such as strings, vectors, maps, optional fields, and enums are intentionally unsupported in v1.

## Public API

| Module               | Responsibility                                                         |
| -------------------- | ---------------------------------------------------------------------- |
| `schema`             | Payload field types, normalization, and validation.                    |
| `layout`             | Packed offset and size calculation for payload fields.                 |
| `config`             | `createGeneratorConfig` and package-name helpers.                      |
| `assembly`           | sBPF assembly source rendering from admin and payload size.            |
| `bytecode`           | Assembly-to-ELF compilation via `@blueshift-gg/sbpf-assembler`.        |
| `artifacts`          | `createDopplerArtifacts` — assembly, bytecode, and manifest in memory. |
| `sdk/typescript`     | `renderPayloadCodecSdk` for generated payload codec packages.          |
| `sdk/rust`           | `renderRustSdk` matching the `doppler-sdk` layout.                     |
| `transactions`       | `buildDeployTransactions` for unsigned Loader v3 deploy bundles.       |
| `programs/loader-v3` | Loader v3 instruction builders used by deploy transactions.            |
| `public-key`         | Solana address decoding and assembly literal helpers.                  |

The current Doppler program does not embed the program ID in bytecode. Program ID is written to the manifest. The bytecode embeds the admin address and payload size.

## Deploy transactions

`buildDeployTransactions` accepts precompiled bytecode and returns unsigned transactions in Loader v3 order: `initializeBuffer`, `Write` chunks, then `DeployWithMaxDataLen`. Core builds transactions only; signing, sending, and confirmation are left to the caller (the CLI handles that layer).

## Tests

```sh
bun run test
bun run typecheck
bun run build
```

Unit tests under `tests/` cover schema layout, assembly rendering, bytecode compilation, SDK emission, and deploy transaction construction.
