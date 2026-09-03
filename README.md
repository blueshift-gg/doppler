![](./assets/logo.svg)

<h3 align="center">
  A 21 CU Solana Oracle Program
</h3>

## Overview

Doppler is an ultra-optimized oracle program for Solana, achieving unparalleled performance at just **21 Compute Units (CUs)** per update. Built with low-level optimizations and minimal overhead, Doppler sets the standard for high-frequency, low-latency price feeds on Solana.

## Features

- **21 CU Oracle Updates**: The most efficient oracle implementation on Solana
- **Generic Payload Support**: Flexible data structure supporting any fixed-size payload type
- **Timestamp-Based Updates**: Built-in replay protection and ordering guarantees
- **Zero Dependencies**: Pure no_std Rust implementation for minimal overhead
- **Direct Memory Operations**: Optimized assembly-level exits for maximum efficiency
- **No Toolchain**: `doppler::generate` emits your program as a 328-byte sBPF v3 ELF, with your admin key in the bytecode

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

## Manifest

Every Doppler feed is one program with one admin and one payload, described by a `doppler.json`
that the publisher, every SDK and every consumer share:

```json
{
  "program": "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm",
  "admin": "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE",
  "fields": [
    { "name": "price", "type": "i64" },
    { "name": "conf", "type": "u64" },
    { "name": "expo", "type": "i32" }
  ]
}
```

The feed account is derived from the admin and the program, so there is nothing else to look up.

## Architecture

Doppler uses a simple yet powerful architecture:

1. **Admin Account**: Controls oracle updates (hardcoded in the bytecode for security)
2. **Feed Account**: Stores the last-updated timestamp and payload data
3. **Timestamp Validation**: Ensures updates are monotonically increasing

### Data Structure

| bytes    | field             |                                             |
| -------- | ----------------- | ------------------------------------------- |
| `0..8`   | `last_updated_ms` | `u64`, little-endian, must grow every write |
| `8..8+N` | payload           | your schema, packed, no padding             |

An update instruction carries the same bytes. The program checks that the admin signed and that
the timestamp grew, then copies them in. Nothing else happens on-chain, which is where the 21
compute units come from.

## Usage Guide

### 1. Load the Manifest

```rust
use doppler_sdk::{doppler::Price, Doppler};

let doppler = Doppler::<Price>::load("doppler.json")?;
```

`load` checks that `Price` is the size the manifest's fields describe, so a mismatched payload
type is an error here and not a corrupted account later.

### 2. Deploy

```rust
doppler.deploy().send(&[&admin, &program_keypair], &rpc)?;
```

One transaction writes the program, makes it immutable, and creates the feed account. The program
keypair is needed only here; the admin pays.

### 3. Update

```rust
doppler.update(&Price { price: 17_234_000_000, conf: 5_000_000, expo: -8 })
    .unit_price(1_000)                              // micro-lamports per CU
    .send(&[&admin], &rpc)?;
```

`update` stamps the current time, sets the exact compute budget for the transaction, signs with
the admin, sends, and returns once confirmed. Signers are passed the way
`Transaction::new_signed_with_payer` takes them, so a wallet or HSM works as well as a keypair.

### 4. Read

```rust
let reading = doppler.read(&rpc)?;                  // Reading<Price>
println!("{} at {} ms", reading.value.price, reading.last_updated_ms);
```

On-chain, from any framework:

```rust
let feed = doppler::read(account.data(), account.owner(), &FEED_PROGRAM, doppler::Price::SIZE)?;
let price = doppler::price_no_older_than(&feed, clock.unix_timestamp as u64 * 1000, 5_000)?;
```

### 5. Your Own Transaction

For batching, versioned transactions, or a custom sender, take the raw instruction and set the
budget yourself:

```rust
let ix = doppler.update(&price).at(timestamp_ms).instruction();
let cu = doppler::update_cu(doppler::Price::SIZE);   // 25 for Price
```

## Performance Optimization Tips

### 1. Compute Budget Configuration

- **Exact CU Request**: `update(..).send(..)` requests exactly what the transaction consumes
- **Priority Fees**: `unit_price` is the one knob; pick it from network congestion
- **Account Data Size**: the loaded-accounts-data-size limit is computed from the program and the feed, per SIMD-0186

### 2. Batching Updates

Each program is one feed. To update several feeds in one transaction, collect their
`.instruction()`s and set one budget for the transaction: `doppler::update_cu` per update, and
per SIMD-0186 every unique account costs 64 bytes plus its data.

### 3. Network Optimization

```rust
// Use getRecentPrioritizationFees to determine your fee
let recent_fees = client.get_recent_prioritization_fees(&[doppler.address()])?;
let unit_price = choose_fee(recent_fees);

doppler.update(&price).unit_price(unit_price).send(&[&admin], &rpc)?;
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

### E2E

```bash
surfpool start                         # surfpool 1.5.0 or newer
RPC_URL=http://localhost:8899 cargo run --bin deploy
RPC_URL=http://localhost:8899 cargo run --bin update
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
let elf = doppler::generate(&admin, doppler::Price::SIZE);
```

## Security Considerations

1. **Admin Key**: The admin key is hardcoded in the program for security
2. **Timestamp Validation**: Prevents replay attacks and ensures ordering
3. **No External Dependencies**: Reduces attack surface
4. **Direct Memory Operations**: Eliminates unnecessary abstraction layers
5. **Immutable Programs**: `deploy` removes the upgrade authority; a new admin or payload is a new program

Doppler is a signed on-chain cache, not a decentralized oracle. One hot admin key writes every
update, there is no quorum, and the timestamp is set by the publisher. Consumers must check
freshness, which `price_no_older_than` does.

## Benchmarks

| Operation          | Compute Units |
| ------------------ | ------------- |
| Oracle Update      | 21            |
| Sequence Check     | 5             |
| Payload Write      | 10            |
| Admin Verification | 6             |

Larger payloads add one load/store pair per 8, 4, 2 or 1 bytes, and from seven pairs the copy is
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
A: Doppler uses direct memory operations, inline assembly optimizations, and zero-overhead abstractions to achieve minimal compute usage.

**Q: Can I use custom payload types?**
A: Yes! Doppler is generic over any packed `Pod` type. Define your structure, list its fields in the manifest, and use it with the SDK.

**Q: How do I handle feed account creation?**
A: `deploy` creates it in the same transaction as the program, with `create_account_with_seed` and the admin as the base key, which is the cheapest way.

**Q: What's the maximum update frequency?**
A: Limited only by Solana's throughput. With 21 CUs, you can update as fast as you land. Timestamps are in milliseconds, so many updates per second stay ordered.

**Q: Which Solana version do I need?**
A: The program is sBPF v3. Mainnet, devnet and testnet run it; locally you need Agave 4.0 or newer, which is surfpool 1.5.0 or newer.

## Support

For issues, questions, or contributions:

- GitHub: [@blueshift-gg](https://github.com/blueshift-gg)
- X: [@blueshift](https://x.com/blueshift)
- Discord: [discord.gg/blueshift](https://discord.gg/blueshift)

## License

Licensed under [MIT](./LICENSE).
