![](./assets/logo.svg)

<h3 align="center">
  A 21 CU Solana Oracle Program
</h3>

## Overview

Doppler is an ultra-optimized oracle program for Solana, achieving unparalleled performance at just **21 Compute Units (CUs)** per update. Built with low-level optimizations and minimal overhead, Doppler sets the standard for high-frequency, low-latency price feeds on Solana.

## Features

- **21 CU Oracle Updates**: The most efficient oracle implementation on Solana
- **Generic Payload Support**: Flexible data structure supporting any fixed-size payload type
- **Sequenced Updates**: a strictly increasing sequence gives replay protection and ordering; the SDK uses unix milliseconds
- **Zero Dependencies**: Pure no_std Rust implementation for minimal overhead
- **Direct Memory Operations**: Optimized assembly-level exits for maximum efficiency
- **No Toolchain**: `doppler::generate` emits your program as an sBPF v3 ELF, 328 bytes for a `u64` feed and at most 392, with your admin key in the bytecode
- **No Keypairs**: a feed is its admin and a seed; the program and the feed account derive from them, and `deploy` is one transaction signed by the admin alone

## Installation

Add the Doppler SDK and the Solana crates it hands you back to your `Cargo.toml`:

```toml
[dependencies]
doppler-sdk = "0.1.0"
solana-client = "4"
solana-keypair = "3"
solana-signer = "3"
```

A program that reads a feed needs only the core, without its generator:

```toml
[dependencies]
doppler = { version = "0.1.0", default-features = false }
```

In TypeScript, one package per client library, each over the same core:

```bash
bun add @blueshift-gg/doppler-kit @solana/kit @solana-program/loader-v3 @solana-program/system @solana-program/compute-budget
bun add @blueshift-gg/doppler-web3js @solana/web3.js@3.0.0-rc.3
```

`@blueshift-gg/doppler` alone has no dependencies: the manifest, the payload codec, the budget, and
the program generator, for a browser, a worker, or a server that only reads feeds.

## Manifest

Every Doppler feed is one program with one admin and one payload, described by a `doppler.json`
that the publisher, every SDK and every consumer share:

```json
{
  "admin": "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE",
  "seed": "SOL/USD",
  "fields": [
    { "name": "price", "type": "i64" },
    { "name": "conf", "type": "u64" },
    { "name": "expo", "type": "i32" }
  ]
}
```

A feed is its admin and its seed. The program is `create_with_seed(admin, seed, loader)` and the
feed account `create_with_seed(admin, "feed", program)`, so there is no program keypair to make or
keep, nothing else to look up, and one admin runs as many feeds as it has seeds.

## Architecture

Doppler uses a simple yet powerful architecture:

1. **Admin Account**: Controls oracle updates (hardcoded in the bytecode for security)
2. **Feed Account**: Stores the sequence and payload data
3. **Sequence Validation**: Ensures updates are monotonically increasing

### Data Structure

| bytes    | field      |                                             |
| -------- | ---------- | ------------------------------------------- |
| `0..8`   | `sequence` | `u64`, little-endian, must grow every write |
| `8..8+N` | payload    | your schema, packed, no padding             |

An update instruction carries the same bytes. The program checks that the admin signed and that
the sequence grew, then copies them in. Nothing else happens on-chain, which is where the 21
compute units of a `u64` feed come from; `doppler::update_cu` gives the number for any payload,
25 for `Price`.

## Usage Guide

### 1. Load the Manifest

```rust
use doppler_sdk::{doppler::Price, now_ms, DopplerClient, Reading, SendOptions};
use solana_client::rpc_client::RpcClient;

let rpc = RpcClient::new("https://api.mainnet-beta.solana.com");
let manifest = std::fs::read_to_string("doppler.json")?.parse()?;
let doppler = DopplerClient::<Price>::load(manifest, SendOptions { rpc: &rpc, unit_price: 1_000 })?;
```

`load` checks that `Price` is the size the manifest's fields describe, so a mismatched payload
type is an error here and not a corrupted account later. `unit_price` is the priority fee in
micro-lamports per compute unit, used by every `send`; `doppler.options` is public, so a publisher
can follow the fee market.

### 2. Deploy

```rust
doppler.deploy().send(&[&admin])?;
```

One transaction writes the program, makes it immutable, and creates the feed account. The admin is
the only signer and pays; `doppler.program()` is the address.

### 3. Update

```rust
doppler.update(now_ms(), &Price { price: 17_234_000_000, conf: 5_000_000, expo: -8 })
    .send(&[&admin])?;
```

`update` takes the sequence, unix milliseconds by convention, sets the exact compute budget for the
transaction, signs with the admin, sends, and returns once confirmed. Signers are passed the way
`Transaction::new_signed_with_payer` takes them, so a wallet or HSM works as well as a keypair.

### 4. Read

```rust
let Reading { sequence, value: Price { price, .. } } = doppler.read()?;   // fields copied out: Price is packed
println!("{price} at {sequence} ms");
```

On-chain, from any framework:

```rust
let feed = doppler::read(account.data(), account.owner(), &FEED_PROGRAM, doppler::Price::SIZE)?;
let price = doppler::price_no_older_than(&feed, clock.unix_timestamp as u64 * 1000, 5_000)?;
```

The sequence is any strictly increasing `u64` the publisher chooses. The SDK writes unix
milliseconds, which is what `price_no_older_than` assumes; a feed that counts instead carries its
own time in the payload, or offers no freshness.

### 5. Your Own Transaction

Both operations hand you their raw instructions and a `Budget`:

```rust
let update = doppler.update(now_ms(), &price).instruction();
update.instruction;                 // the admin signs
update.budget;                      // Budget { compute_units: 25, loaded_bytes: 661, requested_compute_units: 475, requested_loaded_bytes: 811, lamports }

let deploy = doppler.deploy().instructions();
deploy.instructions;                // create and fill the buffer, create the program, deploy it immutable, create the feed
deploy.budget;                      // Budget { compute_units: 10_080, loaded_bytes: 627, requested_compute_units: 10_530, requested_loaded_bytes: 777, lamports }
```

`compute_units` and `loaded_bytes` are the instructions' own: what they add to any transaction, per
SIMD-0186 every account at 64 bytes plus its data. The `requested_` pair is what `send` sets for a
transaction holding only them: three compute-budget builtins at 150 units, and two more accounts,
the payer and the compute-budget program. `lamports` is that transaction's fee at `unit_price`:
5,000 per signature plus `ceil(unit_price × requested_compute_units / 1e6)`.

### TypeScript

The same client, with the same four calls, for `@solana/kit` and for `@solana/web3.js` 3:

```ts
import { Doppler } from '@blueshift-gg/doppler-kit';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
const doppler = await Doppler.load({
  program: 'fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm',
  admin: 'admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE',
  fields: [{ name: 'price', type: 'i64' }, { name: 'conf', type: 'u64' }, { name: 'expo', type: 'i32' }],
});

await doppler.deploy().send([admin, programKeypair], { rpc, unitPrice: 1_000 });          // once
await doppler.update({ price: 17_234_000_000n, conf: 5_000_000n, expo: -8 }).send([admin], { rpc, unitPrice: 1_000 });

const { lastUpdatedMs, value } = await doppler.read(rpc);
for await (const reading of doppler.subscribe(createSolanaRpcSubscriptions('wss://...'), { signal })) {
  console.log(reading.value.price, reading.lastUpdatedMs);
}

const ixs = doppler.update(value).instructions({ unitPrice: 1_000 });   // [price, loaded size, limit, update]
const ix = doppler.update(value).instruction();                          // just the update
```

`load` validates the manifest and derives the feed address. Written inline, the manifest types the
value: `{ price: bigint; conf: bigint; expo: number }`, arrays for `len > 1`. A `doppler.json` import
is validated the same way and typed loosely. Signers are `TransactionSigner`s, so a wallet works
like a keypair; `send` resolves once the transaction is confirmed.

`@blueshift-gg/doppler-web3js` is identical over `Connection`, `Keypair` and `PublicKey`:
`send([admin], { rpc: connection, unitPrice })`, `read(connection)`, `subscribe(connection)`.

## Performance Optimization Tips

### 1. Compute Budget Configuration

- **Exact CU Request**: `send` requests exactly what the transaction consumes
- **Three budget instructions**: price and limit are the usual two; the loaded-accounts-data-size limit costs 150 units and cuts the transaction's scheduling cost for loaded data from 16,384 (the 64 MiB default, 2,048 pages at 8) to 8
- **Priority Fees**: `doppler.options.unit_price` is the one knob; pick it from network congestion
- **Account Data Size**: the loaded-accounts-data-size limit is computed from the program and the feed, per SIMD-0186

### 2. Batching Updates

Each program is one feed. To update several feeds in one transaction, collect their
`.instruction()`s and set one budget: the sum of their `budget.compute_units` plus 150 per
compute-budget instruction, and the sum of their `budget.loaded_bytes` plus 64 for the payer and
86 for the compute-budget program.

### 3. Network Optimization

```rust
// Use getRecentPrioritizationFees to determine your fee
let recent_fees = rpc.get_recent_prioritization_fees(&[doppler.address()])?;
doppler.options.unit_price = choose_fee(recent_fees);

doppler.update(now_ms(), &price).send(&[&admin])?;
```

## Testing

### Build

```bash
# Within root
cargo build-sbf --manifest-path program/Cargo.toml
```

### Unit

Run the test suite:

```bash
# Run all tests
cargo test
```

`doppler/tests/sweep.rs` runs the generated program through Mollusk for every payload size from 1
to 64: exact bytes copied, stale and unsigned updates rejected, and the metered compute units equal
to `doppler::update_cu`. No Solana toolchain is needed for it.

`doppler/tests/vectors.rs` writes `doppler/tests/vectors.json`: programs for seven payload sizes,
the feed address, the wire bytes and budget of a `Price` update, and the rent of a deploy. The
TypeScript packages reproduce every byte of it:

```bash
bun install && bun run build && bun test
```

### E2E

```bash
surfpool start                         # surfpool 1.5.0 or newer
RPC_URL=http://localhost:8899 cargo run --bin deploy
RPC_URL=http://localhost:8899 cargo run --bin update
DOPPLER_RPC=http://localhost:8899 DOPPLER_WS=ws://localhost:8900 bun test   # deploy, update, read, subscribe
```

The program is sBPF v3 under the gate mainnet activated, which Agave carries from 4.0 on; surfpool
1.5.0 is the first release built on it, and anything older reports the program as not deployed.

example of a deploy transaction:

```
  Instruction 0   11111111111111111111111111111111             create buffer
  Instruction 1   BPFLoaderUpgradeab1e11111111111111111111111  initialize buffer
  Instruction 2   BPFLoaderUpgradeab1e11111111111111111111111  write 360 bytes
  Instruction 3   11111111111111111111111111111111             create program
  Instruction 4   BPFLoaderUpgradeab1e11111111111111111111111  deploy
  Instruction 5   BPFLoaderUpgradeab1e11111111111111111111111  set upgrade authority: none
  Instruction 6   11111111111111111111111111111111             create feed account
  Status: Ok
```

example of an update transaction:

```
  Instruction 0   ComputeBudget111111111111111111111111111111  set_compute_unit_price
  Instruction 1   ComputeBudget111111111111111111111111111111  set_loaded_accounts_data_size_limit 811
  Instruction 2   ComputeBudget111111111111111111111111111111  set_compute_unit_limit 475
  Instruction 3   <your program>
  Status: Ok
  Compute Units Consumed: 475
    Program <your program> consumed 25 of 25 compute units
```

> A `u64` feed is `471 CU` + a `767` byte loaded-accounts-data-size limit; the `Price` feed above
> is `475` and `811`. Both landed at exactly those numbers on surfpool 1.5.0 and on an Agave 4.2.2
> validator.

### Expected Priority Score

based on the [Anza's blog post](https://www.anza.xyz/blog/cu-optimization-with-setloadedaccountsdatasizelimit)

let's assume we are going to update a single `u64` feed:

- 1 signature
- 0 write locks
- Requested compute-budget-limit of 471 CUs (21 for the update, 150 per compute-budget instruction)
- Paying priority fee: 1.00 lamports per CU

| Metric                         | Without Instruction              | With 767 byte Limit             |
| ------------------------------ | -------------------------------- | ------------------------------- |
| Loaded Account Data Size Limit | 64M                              | 767 bytes                       |
| Data Size Cost Calculation     | 64M x (8/32K)                    | 767 bytes x (8/32K)             |
| Data Size Cost (CUs)           | 16,000                           | 0.187                           |
| Reward to Leader Calculation   | (1 x 5000 + 1 x 471)/2           | (1 x 5000 + 1 x 471)/2          |
| Reward to Leader (lamports)    | 2,735.5                          | 2,735.5                         |
| Transaction Cost Formula       | 1 x 720 + 0 x 300 + 471 + 16,000 | 1 x 720 + 0 x 300 + 471 + 0.187 |
| Transaction Cost (CUs)         | 17,191                           | 1,191.187                       |
| Priority Score                 | 0.159                            | 2.297                           |

## Building

Build the on-chain program from Rust:

```bash
# Build for Solana BPF
cargo build-sbf --manifest-path program/Cargo.toml
```

or generate it, which is what `deploy` does:

```rust
let elf = doppler::generate(admin.pubkey().as_array(), doppler::Price::SIZE);
```

## Security Considerations

1. **Admin Key**: The admin key is hardcoded in the program for security
2. **Timestamp Validation**: Prevents replay attacks and ensures ordering
3. **No External Dependencies**: Reduces attack surface
4. **Direct Memory Operations**: Eliminates unnecessary abstraction layers
5. **Immutable Programs**: `deploy` removes the upgrade authority; a new admin or payload is a new program

Doppler is a signed on-chain cache, not a decentralized oracle. One hot admin key writes every
update, there is no quorum, and the sequence is set by the publisher. Consumers must check
freshness, which `price_no_older_than` does.

## Benchmarks

| Operation          | Compute Units |
| ------------------ | ------------- |
| Oracle Update      | 21            |
| Sequence Check     | 5             |
| Payload Write      | 10            |
| Admin Verification | 6             |

Larger payloads add one load/store pair per 8, 4, 2 or 1 bytes, and from six pairs the copy is
one `sol_memcpy_` call:

| payload     | bytes | CU  |
| ----------- | ----- | --- |
| `u64`       | 8     | 21  |
| `Price`     | 20    | 25  |
| `[u8; 32]`  | 32    | 27  |
| 56 and up   | 56+   | 31  |

## Example Payloads

Payloads are packed, with no padding, so every type derives `Pod` and is `#[repr(C, packed)]`.

### Simple Price Feed

```rust
#[repr(C, packed)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct PriceFeed {
    pub price: u64,
}
```

### Standard Price Feed

The fields of a Pyth price feed, minus publish time, which is the header:

```rust
#[repr(C, packed)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct Price {
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
}
```

### AMM Oracle

```rust
#[repr(C, packed)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct PropAMM {
    pub bid: u64,
    pub ask: u64,
}
```

### Complex Market Data

```rust
#[repr(C, packed)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct MarketData {
    pub price: u64,
    pub volume: u64,
    pub confidence: u32,
}
```

## FAQ

**Q: Why only 21 CUs?**
A: Doppler uses direct memory operations, inline assembly optimizations, and zero-overhead abstractions to achieve minimal compute usage. 21 is a `u64` feed; every 8 bytes of payload adds 2, so `Price` is 25, and from six chunks the copy is one `sol_memcpy_` at 31. `doppler::update_cu` gives the number for any size.

**Q: Can I use custom payload types?**
A: Yes! Doppler is generic over any packed `Pod` type. Define your structure, list its fields in the manifest, and use it with the SDK. In TypeScript the manifest's fields type the value.

**Q: How do I handle feed account creation?**
A: `deploy` creates it in the same transaction as the program, with `create_account_with_seed` and the admin as the base key, which is the cheapest way.

**Q: What's the maximum update frequency?**
A: Limited only by Solana's throughput. With 21 CUs, you can update as fast as you land. The sequence is any strictly increasing u64; the examples pass unix milliseconds, so many updates per second stay ordered, and a publisher that needs more picks microseconds or a counter.

**Q: Which Solana version do I need?**
A: The program is sBPF v3. Mainnet, devnet and testnet run it; locally you need Agave 4.0 or newer, which is surfpool 1.5.0 or newer.

## Support

For issues, questions, or contributions:

- GitHub: [@blueshift-gg](https://github.com/blueshift-gg)
- X: [@blueshift](https://x.com/blueshift)
- Discord: [discord.gg/blueshift](https://discord.gg/blueshift)

## License

Licensed under [MIT](./LICENSE).
