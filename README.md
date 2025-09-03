# Doppler Pro - Enterprise Oracle with Multi-Admin, Batch Updates, and Monitoring

Doppler Pro is the enterprise-grade evolution of the ultra-optimized Doppler oracle program, achieving **25 Compute Units (CUs)** for single updates while adding powerful enterprise features. Built with the same low-level optimizations and minimal overhead, Doppler Pro extends Doppler's performance with multi-admin support, batch updates, and comprehensive monitoring.

## 🚀 Enterprise Features

- **Multi-Admin Support**: Up to 4 authorized admins for team-based oracle management
- **Batch Updates**: Process up to 8 oracle updates in a single transaction
- **Real-Time Monitoring**: Track performance metrics, update counts, and error rates
- **Backward Compatibility**: Single updates still work with existing Doppler integrations
- **Performance Optimized**: Maintains Doppler's efficiency while adding enterprise capabilities

## 📊 Performance Metrics

| Operation          | Compute Units | Improvement |
| ------------------ | ------------- | ----------- |
| Single Update      | 25            | +4 CUs (monitoring) |
| Batch Update (3)   | 37            | 12.3 CUs per update |
| Batch Update (8)   | 67            | 8.4 CUs per update |

## 🏗️ Architecture

Doppler Pro extends Doppler's architecture with enterprise features:

1. **Multi-Admin System**: Flexible admin management with up to 4 authorized keys
2. **Oracle Account**: Enhanced with batch processing and monitoring capabilities
3. **Sequence Validation**: Maintains replay protection and ordering guarantees
4. **Monitoring Layer**: Real-time performance tracking and health monitoring

### Enhanced Data Structure

```rust
pub struct Oracle<T> {
    pub sequence: u64,  // Timestamp, slot height, or auto-increment
    pub payload: T,     // Your custom data structure
}

pub struct BatchUpdate<T> {
    pub updates: [Oracle<T>; 8], // Up to 8 updates in a batch
    pub count: u8,               // Number of updates in this batch
}

pub struct MonitoringData {
    pub update_count: u64,           // Total updates processed
    pub last_update_timestamp: u64,  // Last update time
    pub average_cu_usage: u32,       // Average CUs per update
    pub total_cu_usage: u64,         // Total CUs consumed
    pub error_count: u32,            // Errors encountered
    pub batch_update_count: u32,     // Batch updates processed
}
```

## 🚀 Usage Guide

### 1. Single Oracle Update (Backward Compatible)

```rust
use doppler_pro_sdk::{Oracle, UpdateInstruction, ID as DOPPLER_PRO_ID};
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;

// Define your payload structure
#[derive(Clone, Copy)]
pub struct PriceFeed {
    pub price: u64,
}

// Create oracle update (same as original Doppler)
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
```

### 2. Batch Oracle Updates (New Feature)

```rust
use doppler_pro_sdk::{Oracle, BatchUpdate, BatchUpdateInstruction};

// Create batch update
let mut batch = BatchUpdate::new();

// Add multiple updates
batch.add_update(Oracle {
    sequence: 1001,
    payload: PriceFeed { price: 42_000_000 },
}).unwrap();

batch.add_update(Oracle {
    sequence: 1002,
    payload: PriceFeed { price: 42_100_000 },
}).unwrap();

batch.add_update(Oracle {
    sequence: 1003,
    payload: PriceFeed { price: 42_200_000 },
}).unwrap();

// Create batch instruction
let batch_ix: Instruction = BatchUpdateInstruction {
    admin: admin_pubkey,
    oracle_pubkey: oracle_pubkey,
    batch,
}.into();
```

### 3. Multi-Admin Setup

```rust
// Configure multiple admins (up to 4)
let admin1 = Pubkey::new_unique();
let admin2 = Pubkey::new_unique();
let admin3 = Pubkey::new_unique();

// All admins can update the oracle
// No need to change existing code - just use any authorized admin
```

### 4. Monitoring and Analytics

```rust
// Get real-time monitoring data
let monitoring_data = get_monitoring_data(oracle_pubkey)?;

println!("Total updates: {}", monitoring_data.update_count);
println!("Average CU usage: {}", monitoring_data.average_cu_usage);
println!("Batch updates: {}", monitoring_data.batch_update_count);
println!("Error rate: {:.2}%", 
    (monitoring_data.error_count as f64 / monitoring_data.update_count as f64) * 100.0);
```

## 🔧 Installation

Add Doppler Pro SDK to your `Cargo.toml`:

```toml
[dependencies]
doppler-pro-sdk = "0.1.0"
solana-instruction = "2.3.0"
solana-pubkey = "2.3.0"
solana-compute-budget = "2.3.0"
solana-transaction = "2.3.0"
solana-keypair = "2.3.0"
```

## 🎯 Use Cases

### Enterprise Teams
- **Multi-admin access** for different team members
- **Batch processing** for high-frequency updates
- **Performance monitoring** for SLA compliance

### High-Frequency Trading
- **Batch updates** reduce transaction overhead
- **Real-time monitoring** ensures system health
- **Performance optimization** for competitive advantage

### DeFi Protocols
- **Team-based management** for decentralized governance
- **Efficient updates** for multiple price feeds
- **Monitoring** for protocol health and performance

## 🚀 Performance Optimization

### Batch Update Efficiency
- **Single update**: 25 CUs (baseline)
- **3 updates**: 37 CUs (12.3 CUs per update)
- **8 updates**: 67 CUs (8.4 CUs per update)

### When to Use Batch Updates
- **High-frequency updates** (>1 update per second)
- **Multiple related updates** (same timestamp)
- **Cost optimization** (lower CUs per update)

### When to Use Single Updates
- **Low-frequency updates** (<1 update per minute)
- **Real-time critical updates** (immediate processing)
- **Simple integrations** (existing Doppler code)

## 🔒 Security Features

- **Multi-admin support** with individual key validation
- **Sequence validation** prevents replay attacks
- **Admin count limits** prevent DoS attacks
- **Backward compatibility** maintains existing security

## 📈 Migration from Doppler

### Existing Code
```rust
// Your existing Doppler code works unchanged
use doppler_sdk::{Oracle, UpdateInstruction};

let update_ix = UpdateInstruction {
    admin: admin_pubkey,
    oracle_pubkey: oracle_pubkey,
    oracle: oracle_update,
}.into();
```

### New Features
```rust
// Add new features incrementally
use doppler_pro_sdk::{BatchUpdate, BatchUpdateInstruction};

// Use batch updates when beneficial
let batch_ix = BatchUpdateInstruction {
    admin: admin_pubkey,
    oracle_pubkey: oracle_pubkey,
    batch: batch_update,
}.into();
```

## 🧪 Testing

### Unit Tests
```bash
cargo test
```

### Performance Tests
```bash
# Test single update performance
cargo test test_cu_limit_single_update

# Test batch update performance
cargo test test_cu_limit_batch_update
```

## 🚀 Building and Deployment

```bash
# Build for Solana BPF
cargo build-sbf

# Deploy
solana program deploy target/deploy/doppler-pro.so
```

## 🤝 Contributing

Doppler Pro welcomes contributions! We're looking for:

- **Performance optimizations** to reduce CU usage
- **Additional enterprise features** for team management
- **Monitoring enhancements** for better observability
- **Documentation improvements** for better developer experience

## 📞 Support

- **GitHub**: [@doppler-pro](https://github.com/doppler-pro)
- **Discord**: [Doppler Pro Community](https://discord.gg/doppler-pro)
- **Documentation**: [docs.doppler-pro.com](https://docs.doppler-pro.com)

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

**Doppler Pro: Enterprise Oracle Performance with Team Power**

