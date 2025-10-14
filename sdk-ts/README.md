# Doppler TypeScript SDK

Minimal bindings for interacting with the Doppler oracle program. The SDK keeps payload encoding and decoding generic so projects can define their own data layout.

## Design choices

- **Payload codecs are caller-supplied.** `encodeOracleData`/`decodeOracleData` accept encoder/decoder functions so the same helpers work for u64 price feeds or custom structs without pulling in opinionated codecs.
- **Transaction builder mirrors Rust SDK ergonomics.** `DopplerTransactionBuilder` batches updates, tracks compute budget sizing, and stays close to the on-chain API without introducing additional abstractions.
- **Bun is the default runtime and package manager.** Using Bun keeps the dependency footprint small, speeds up local workflows, and avoids adding extra tooling just to run tests or scripts.
- **Kit unlocks future abstractions.** `@solana/kit` provides high-level RPC and transaction helpers. The current SDK stays minimal but the `tests/helpers.ts` file shows how richer helpers could compose the same primitives later.
- **Examples stay minimal.** The `examples/` directory shows the short paths for admin updates, batch updates, and read-only account access.
- **Tests rely on local validator setup.** Integration tests assume you already started `doppler/test-validator.sh` and focus on end-to-end flows rather than mocking RPC clients.

## Development quickstart

```bash
cd doppler
./test-validator.sh


# in a new terminal window
cd sdk-ts
bun test
```

Examples can be run individually. For instance:

```bash
bun examples/admin-update.ts
bun examples/admin-batch-update.ts
bun examples/read-oracle.ts
```

Ensure the validator script remains running in another terminal while executing examples or tests.
