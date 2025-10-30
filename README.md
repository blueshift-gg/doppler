![](./assets/logo.svg)

<h3 align="center">
  A 21 CU Solana Oracle Program
</h3>

## Overview

Doppler is an ultra-optimized oracle program for Solana, achieving unparalleled performance at just **21 Compute Units (CUs)** per update. Built with low-level optimizations and minimal overhead, Doppler sets the standard for high-frequency, low-latency price feeds on Solana.

## Features

- **21 CU Oracle Updates**: The most efficient oracle implementation on Solana
- **Generic Payload Support**: Flexible data structure supporting any payload type
- **Sequence-Based Updates**: Built-in replay protection and ordering guarantees
- **Zero Dependencies**: Pure no_std Rust implementation for minimal overhead
- **Direct Memory Operations**: Optimized assembly-level exits for maximum efficiency

## Installation

Add Doppler SDK and required Solana crates to your `Cargo.toml`:

```toml
[dependencies]
doppler-sdk = "0.1.0"
solana-instruction = "2.3.0"
solana-pubkey = "2.3.0"
solana-compute-budget-interface = "2.2.2"
solana-transaction = "2.3.0"
solana-keypair = "2.3.0"
solana-signer = "2.2.1"
# Add other Solana crates as needed
```

## Program ID

```
fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm
```

## Architecture

Doppler uses a simple yet powerful architecture:

1. **Admin Account**: Controls oracle updates (hardcoded for security)
2. **Oracle Account**: Stores the sequence number and payload data
3. **Sequence Validation**: Ensures updates are monotonically increasing

### Data Structure

```rust
pub struct Oracle<T> {
    pub sequence: u64,  // Timestamp, slot height, or auto-increment
    pub payload: T,     // Your custom data structure
}
```

### Example Payloads

#### Simple Price Feed

```rust
#[derive(Clone, Copy)]
pub struct PriceFeed {
    pub price: u64,
}
```

#### AMM Oracle

```rust
#[derive(Clone, Copy)]
pub struct PropAMM {
    pub bid: u64,
    pub ask: u64,
}
```

#### Complex Market Data

```rust
#[derive(Clone, Copy)]
pub struct MarketData {
    pub price: u64,
    pub volume: u64,
    pub confidence: u32,
}
```

## Usage Guide

### Simple Oracle Update

```rust
use doppler_sdk::{Oracle, UpdateInstruction, ID as DOPPLER_ID, transaction::Builder};
use solana_pubkey::Pubkey;

// Define your oracle key
let oracle_pubkey = Pubkey::from_str_const("QUVF91dzXWYvE5FmFEc41JZxRDmNgx8S8P6sNDWYZiW");

// Define your payload structure
#[derive(Clone, Copy)]
pub struct PriceFeed {
    pub price: u64,
}

// Create oracle update
let oracle_update = Oracle {
    sequence: 1234567890,  // Must be > current sequence
    payload: PriceFeed {
        price: 42_000_000,  // $42.00 with 6 decimals
    },
};

// Create update tx
let transaction = Builder::new(&admin) // your admin keypair
      .add_oracle_update(
          oracle_pubkey,
          oracle_update,
      )
      .with_unit_price(1_000)
      .build(recent_blockhash); // fresh and valid blockhash
```

## Optimization Tips

### 1. Batching Updates

For multiple oracle updates, batch them efficiently:

```rust
// DON'T: Multiple transactions
let mut tx_builder = Builder::new(&admin).with_unit_price(1_000);

for oracle in oracles {
  let transaction = tx_builder.add_oracle_update(oracle).build(recent_blockhash);  // 21 CU each, but multiple transactions
}

// DO: Single transaction with multiple updates
let mut tx_builder = Builder::new(&admin).with_unit_price(1_000);

for (oracle_pubkey oracle_update) in [
       // ... oracles
    ] {
        tx_builder = tx_builder.add_oracle_update(
            oracle_pubkey,
            oracle_update
        );
    }
  
// Single transaction with all updates
let transaction = tx_builder.build(recent_blockhash);
```

### 2. Network Optimization

```rust
// Use getRecentPrioritizationFees to determine optimal fee
let recent_fees = client.get_recent_prioritization_fees(&[oracle_pubkey])?;
let optimal_fee = calculate_optimal_fee(recent_fees);

let mut tx_builder = Builder::new(&admin).with_unit_price(optimal_fee);
```

more example can be found in the [examples folder](https://github.com/blueshift-gg/doppler/tree/master/examples)

## Testing

### Unit

Run the test suite:

```bash
# Run all tests
cargo test
```

### E2E

```bash
./test-validator.sh

cargo run --bin single-price-feed
cargo run --bin multiple-price-feed
```

example of single price feed update response

```
Transaction executed in slot 131:
  Block Time: 2025-09-03T04:23:08+03:00
  Version: legacy
  Recent Blockhash: 89ZvpNezGugkfm9LnN99rhb6aTNaW1cLKkS2DDbr7NPA
  Signature 0: m14zQFvt1jU9YYM2QAmVSnMZUa5P2eKdtP21Shu9w9kEhxKLAfJoUyqZwiTt43hGwewhsahQJi5eLJ71NptUWDu
  Account 0: srw- admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE (fee payer)
  Account 1: -rw- QUVF91dzXWYvE5FmFEc41JZxRDmNgx8S8P6sNDWYZiW
  Account 2: -r-x ComputeBudget111111111111111111111111111111
  Account 3: -r-x fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm
  Instruction 0
    Program:   ComputeBudget111111111111111111111111111111 (2)
    Data: [3, 232, 3, 0, 0, 0, 0, 0, 0]
  Instruction 1
    Program:   ComputeBudget111111111111111111111111111111 (2)
    Data: [2, 215, 1, 0, 0]
  Instruction 2
    Program:   ComputeBudget111111111111111111111111111111 (2)
    Data: [4, 127, 0, 0, 0]
  Instruction 3
    Program:   fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm (3)
    Account 0: admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE (0)
    Account 1: QUVF91dzXWYvE5FmFEc41JZxRDmNgx8S8P6sNDWYZiW (1)
    Data: [159, 136, 1, 0, 0, 0, 0, 0, 64, 226, 1, 0, 0, 0, 0, 0, 160, 213, 119, 107, 1, 0, 0, 0]
  Status: Ok
    Fee: ◎0.000005001
    Account 0 balance: ◎9.999969996 -> ◎9.999964995
    Account 1 balance: ◎0.00100224
    Account 2 balance: ◎0.000000001
    Account 3 balance: ◎0.00114144
  Compute Units Consumed: 471
  Log Messages:
    Program ComputeBudget111111111111111111111111111111 invoke [1]
    Program ComputeBudget111111111111111111111111111111 success
    Program ComputeBudget111111111111111111111111111111 invoke [1]
    Program ComputeBudget111111111111111111111111111111 success
    Program ComputeBudget111111111111111111111111111111 invoke [1]
    Program ComputeBudget111111111111111111111111111111 success
    Program fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm invoke [1]
    Program fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm consumed 21 of 21 compute units
    Program fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm success

Finalized
```

> Fully fledged tx requires: `471 CU` + `111 bytes`

example of multiple price feed update response

```
Transaction executed in slot 218:
  Block Time: 2025-09-06T13:06:05+03:00
  Version: legacy
  Recent Blockhash: AeCvWYJjrx6Yxjknh6ndTTaTYsHkPQgr9iMURRN8Ah4S
  Signature 0: 3MLXk7YCsqEoMiYiGT4RYKa3Js2QJ6acM1BQstKGNbXsUJ6rNaySmUzzqNRDnFd7St1XTpPngAbcnf3ZxD2Lj9Jr
  Account 0: srw- admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE (fee payer)
  Account 1: -rw- QUVF91dzXWYvE5FmFEc41JZxRDmNgx8S8P6sNDWYZiW
  Account 2: -rw- 6uQ848roY5vumz43QeQguE7xCyBSmgZbwNdJMTrs2Xhy
  Account 3: -rw- 9bA7GPqPpZ5aLbwb8E6cKvUPM8pcHXXTqLpf5zLAqHP5
  Account 4: -r-x ComputeBudget111111111111111111111111111111
  Account 5: -r-x fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm
  Instruction 0
    Program:   ComputeBudget111111111111111111111111111111 (4)
    Data: [3, 232, 3, 0, 0, 0, 0, 0, 0]
  Instruction 1
    Program:   ComputeBudget111111111111111111111111111111 (4)
    Data: [4, 175, 0, 0, 0]
  Instruction 2
    Program:   ComputeBudget111111111111111111111111111111 (4)
    Data: [2, 1, 2, 0, 0]
  Instruction 3
    Program:   fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm (5)
    Account 0: admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE (0)
    Account 1: QUVF91dzXWYvE5FmFEc41JZxRDmNgx8S8P6sNDWYZiW (1)
    Data: [2, 0, 0, 0, 0, 0, 0, 0, 180, 134, 1, 0, 0, 0, 0, 0]
  Instruction 4
    Program:   fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm (5)
    Account 0: admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE (0)
    Account 1: 9bA7GPqPpZ5aLbwb8E6cKvUPM8pcHXXTqLpf5zLAqHP5 (3)
    Data: [1, 0, 0, 0, 0, 0, 0, 0, 170, 134, 1, 0, 0, 0, 0, 0]
  Instruction 5
    Program:   fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm (5)
    Account 0: admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE (0)
    Account 1: 6uQ848roY5vumz43QeQguE7xCyBSmgZbwNdJMTrs2Xhy (2)
    Data: [1, 0, 0, 0, 0, 0, 0, 0, 170, 134, 1, 0, 0, 0, 0, 0]
  Status: Ok
    Fee: ◎0.000005001
    Account 0 balance: ◎0.999994999 -> ◎0.999989998
    Account 1 balance: ◎0.00100224
    Account 2 balance: ◎0.00100224
    Account 3 balance: ◎0.00100224
    Account 4 balance: ◎0.000000001
    Account 5 balance: ◎0.00114144
  Compute Units Consumed: 513
  Log Messages:
    Program ComputeBudget111111111111111111111111111111 invoke [1]
    Program ComputeBudget111111111111111111111111111111 success
    Program ComputeBudget111111111111111111111111111111 invoke [1]
    Program ComputeBudget111111111111111111111111111111 success
    Program ComputeBudget111111111111111111111111111111 invoke [1]
    Program ComputeBudget111111111111111111111111111111 success
    Program fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm invoke [1]
    Program fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm consumed 21 of 63 compute units
    Program fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm success
    Program fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm invoke [1]
    Program fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm consumed 21 of 42 compute units
    Program fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm success
    Program fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm invoke [1]
    Program fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm consumed 21 of 21 compute units
    Program fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm success

Finalized
```

### Expected Priority Score

based on the [Anza's blog post](https://www.anza.xyz/blog/cu-optimization-with-setloadedaccountsdatasizelimit) and the code from [single price feed update example](https://github.com/blueshift-gg/doppler/blob/master/examples/src/single_price_feed.rs)

let's assume we are going to update a single oracle:

- 1 signature
- 0 write locks
- Requested compute-budget-limit to 21 (with compute-budget instructions 321 and 471 respectively) CUs
- Paying priority fee: 1.00 lamports per CU

| Metric                         | Without Instruction              | With 111 byte Limit               |
| ------------------------------ | -------------------------------- | --------------------------------- |
| Loaded Account Data Size Limit | 64M                              | 111 bytes                         |
| Data Size Cost Calculation     | 64M x (8/32K)                    | 111 bytes x (8/32K)               |
| Data Size Cost (CUs)           | 16,000                           | 0.02775                           |
| Reward to Leader Calculation   | (1 x 5000 + 1 x 321)/2           | (1 x 5000 + 1 x 471)/2            |
| Reward to Leader (lamports)    | 2,660.5                          | 2,735.5                           |
| Transaction Cost Formula       | 1 x 720 + 0 x 300 + 321 + 16,000 | 1 x 720 + 0 x 300 + 471 + 0.02775 |
| Transaction Cost (CUs)         | 17,041                           | 1,141.02775                       |
| Priority Score                 | 0.156                            | 2.397                             |

## Building

Build the on-chain program:

```bash
# Build for Solana BPF
cargo build-sbf

# Deploy
solana program deploy target/deploy/doppler.so
```

## Security Considerations

1. **Admin Key**: The admin key is hardcoded in the program for security
2. **Sequence Validation**: Prevents replay attacks and ensures ordering
3. **No External Dependencies**: Reduces attack surface
4. **Direct Memory Operations**: Eliminates unnecessary abstraction layers

## Benchmarks

| Operation          | Compute Units |
| ------------------ | ------------- |
| Oracle Update      | 21            |
| Sequence Check     | 5             |
| Payload Write      | 10            |
| Admin Verification | 6             |

## FAQ

**Q: Why only 21 CUs?**
A: Doppler uses direct memory operations, inline assembly optimizations, and zero-overhead abstractions to achieve minimal compute usage.

**Q: Can I use custom payload types?**
A: Yes! Doppler is generic over any `Copy` type. Define your structure and use it with the SDK.

**Q: How do I handle oracle account creation?**
A: However you like, but if you use Solana's `create_account_with_seed` instruction with the admin as the base key it's cheaper!

**Q: What's the maximum update frequency?**
A: Limited only by Solana's throughput. With 21 CUs, you can update as fast as you land.

## Support

For issues, questions, or contributions:

- GitHub: [@blueshift-gg](https://github.com/blueshift-gg)
- X: [@blueshift](https://x.com/blueshift)
- Discord: [discord.gg/blueshift](https://discord.gg/blueshift)

## License

Licensed under [MIT](./LICENSE).
