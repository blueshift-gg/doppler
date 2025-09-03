# Doppler - A 21 CU Solana Oracle Program

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
solana-compute-budget = "2.3.0"
solana-transaction = "2.3.0"
solana-keypair = "2.3.0"
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
    pub sequence: u64,  // Timestamp, block number, or auto-increment
    pub payload: T,     // Your custom data structure
}
```

## Usage Guide

### 1. Setting Up Compute Budget

To achieve the 21 CU performance, configure your transaction with appropriate compute budget:

```rust
use solana_compute_budget::ComputeBudgetInstruction;
use solana_instruction::Instruction;
use solana_transaction::Transaction;

// Request exactly the CUs needed (21 + overhead for other instructions)
let compute_budget_ix = ComputeBudgetInstruction::set_compute_unit_limit(200_000);

// Add to your transaction
let mut instructions = vec![compute_budget_ix];
```

### 2. Setting Priority Fees

For high-frequency oracle updates, use priority fees to ensure timely inclusion:

```rust
// Set priority fee (price per compute unit in micro-lamports)
let priority_fee_ix = ComputeBudgetInstruction::set_compute_unit_price(1000);

instructions.push(priority_fee_ix);
```

### 3. Optimizing Account Data Size

Use `setLoadedAccountsDataSizeLimit` to optimize memory allocation:

```rust
// Set the maximum loaded account data size
// Calculate based on your oracle data structure size
let data_size_limit_ix = ComputeBudgetInstruction::set_loaded_accounts_data_size_limit(
    32_768  // 32KB is usually sufficient for oracle operations
);

instructions.push(data_size_limit_ix);
```

### 4. Creating an Oracle Update

```rust
use doppler_sdk::{Oracle, UpdateInstruction, ID as DOPPLER_ID};
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;

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

// Create update instruction
let update_ix: Instruction = UpdateInstruction {
    admin: admin_pubkey,
    oracle_pubkey: oracle_pubkey,
    oracle: oracle_update,
}.into();

// Add to instructions
instructions.push(update_ix);
```

### 5. Complete Transaction Example

```rust
use doppler_sdk::{Oracle, UpdateInstruction};
use solana_client::rpc_client::RpcClient;
use solana_compute_budget::ComputeBudgetInstruction;
use solana_instruction::Instruction;
use solana_keypair::{Keypair, Signer};
use solana_transaction::Transaction;

async fn update_oracle(
    client: &RpcClient,
    admin: &Keypair,
    oracle_pubkey: Pubkey,
    new_price: u64,
    sequence: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    // Build all instructions
    let mut instructions = vec![
        // 1. Set compute budget
        ComputeBudgetInstruction::set_compute_unit_limit(200_000),
        
        // 2. Set priority fee (1000 micro-lamports per CU)
        ComputeBudgetInstruction::set_compute_unit_price(1000),
        
        // 3. Set loaded accounts data size limit
        ComputeBudgetInstruction::set_loaded_accounts_data_size_limit(32_768),
    ];
    
    // 4. Add oracle update
    let oracle_update = Oracle {
        sequence,
        payload: PriceFeed { price: new_price },
    };
    
    let update_ix: Instruction = UpdateInstruction {
        admin: admin.pubkey(),
        oracle_pubkey,
        oracle: oracle_update,
    }.into();
    
    instructions.push(update_ix);
    
    // Create and send transaction
    let recent_blockhash = client.get_latest_blockhash()?;
    let tx = Transaction::new_signed_with_payer(
        &instructions,
        Some(&admin.pubkey()),
        &[admin],
        recent_blockhash,
    );
    
    let signature = client.send_and_confirm_transaction(&tx)?;
    println!("Oracle updated: {}", signature);
    
    Ok(())
}
```

## Performance Optimization Tips

### 1. Compute Budget Configuration

- **Exact CU Request**: Request only what you need (21 CUs + overhead)
- **Priority Fees**: Use dynamic priority fees based on network congestion
- **Account Data Size**: Minimize loaded data to reduce memory overhead

### 2. Batching Updates

For multiple oracle updates, batch them efficiently:

```rust
// DON'T: Multiple transactions
for oracle in oracles {
    send_update(oracle)?;  // 21 CU each, but multiple transactions
}

// DO: Single transaction with multiple updates
let mut instructions = vec![
    ComputeBudgetInstruction::set_compute_unit_limit(200_000),
    ComputeBudgetInstruction::set_compute_unit_price(1000),
    ComputeBudgetInstruction::set_loaded_accounts_data_size_limit(65_536),
];

for oracle in oracles {
    instructions.push(create_update_instruction(oracle));
}
// Single transaction with all updates
```

### 3. Network Optimization

```rust
// Use getRecentPrioritizationFees to determine optimal fee
let recent_fees = client.get_recent_prioritization_fees(&[oracle_pubkey])?;
let optimal_fee = calculate_optimal_fee(recent_fees);

let priority_ix = ComputeBudgetInstruction::set_compute_unit_price(optimal_fee);
```

## Testing

### Unit

Run the test suite:

```bash
# Run all tests
cargo test
```

### E2E

```bash
solana-test-validator \
    --bpf-program fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm ./target/deploy/doppler.so \
    --account QUVF91dzXWYvE5FmFEc41JZxRDmNgx8S8P6sNDWYZiW ./oracle.json -r
solana -u l airdrop 10 admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE # admin.json keypair

cargo run -p doppler-example
```

example of response

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

> Fully fledged tx requires: `471 CU` + `127 bytes`

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

| Operation | Compute Units |
|-----------|--------------|
| Oracle Update | 21 |
| Sequence Check | 5 |
| Payload Write | 10 |
| Admin Verification | 6 |

## Example Payloads

### Simple Price Feed
```rust
#[derive(Clone, Copy)]
pub struct PriceFeed {
    pub price: u64,
}
```

### AMM Oracle
```rust
#[derive(Clone, Copy)]
pub struct PropAMM {
    pub bid: u64,
    pub ask: u64,
}
```

### Complex Market Data
```rust
#[derive(Clone, Copy)]
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
A: Yes! Doppler is generic over any `Copy` type. Define your structure and use it with the SDK.

**Q: How do I handle oracle account creation?**
A: However you like, but if you use Solana's `create_account_with_seed` instruction with the admin as the base key it's cheaper!

**Q: What's the maximum update frequency?**
A: Limited only by Solana's throughput. With 21 CUs, you can update as fast as you land.

## Support

For issues, questions, or contributions:
- GitHub: [@blueshift_gg](https://github.com/blueshift-gg)
- Twitter: [@blueshift_gg](https://twitter.com/blueshift_gg)

## License

MIT License - See LICENSE file for details
