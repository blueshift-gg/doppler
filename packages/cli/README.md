# @blueshift-gg/doppler-cli

Generate a custom Doppler program binary artifact and matching SDK files from a fixed-size payload schema.

## Get Started

```sh
npx @blueshift-gg/doppler-cli
```

## Workflow

```sh
# 1. Create payload.ts (payload fields only)
npx @blueshift-gg/doppler-cli init

# 2. Build binary, manifest.json, and optional SDKs
npx @blueshift-gg/doppler-cli generate ./payload.ts

# 3. Deploy to a cluster
npx @blueshift-gg/doppler-cli deploy ./doppler.so \
  --program-keypair ./keys/doppler-program-keypair.json \
  --admin <admin-address-from-manifest>
```

## Schema and manifest

`init` writes `payload.ts` with only the payload definition:

```ts
export default {
  payload: {
    price: "u64",
    confidence: "u32",
    slot: "u64",
  },
} as const;
```

`generate` writes `manifest.json` with deployment metadata:

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

## Outputs

The generator can emit:

```txt
<name>.so        Compiled Solana program ELF binary.
doppler.s        Generated sBPF assembly source, if --assembly is provided.
manifest.json    Name, program ID, admin, arch, payload size, schema hash, and ELF hash.
codec/           Generated payload codec package (`package.json` + `src/codecs.ts`), if --typescript-sdk is provided.
rust/            Generated Rust SDK matching doppler-sdk layout, if --rust-sdk is provided.
```

The current Doppler program does not embed the program ID in the binary. Program ID is written to the manifest. The binary embeds the admin address and payload size.

## Integration tests

Rust integration tests under `tests/integration` generate the binary and a Rust SDK into Cargo's `OUT_DIR` at build time, load the program with [Mollusk](https://github.com/anza-xyz/mollusk) and exercise the generated SDK via instruction chains.

```sh
bun run test:integration
```

Generated artifacts stay under `target/` and are not written into the source tree.

The published CLI is Node-compatible and can be invoked with `npx`, `yarn dlx`, `pnpm dlx`, or `bunx`.
Running the CLI without a command prints help by default.
