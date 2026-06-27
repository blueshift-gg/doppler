# doppler-feeder

The off-chain half of Doppler: fetch real prices and push them to a Doppler oracle
on an interval. The on-chain program + `doppler-sdk` already make a single update
~5 lines of code; this crate wraps that in a price **source** + a **run loop** so a
live feed is one call away.

```rust
use doppler_feeder::{Coinbase, Feed, Feeder};
use std::time::Duration;

let feeder = Feeder::new(rpc_url, admin_keypair, Coinbase::usd(), feeds, /*unit_price*/ 1_000);
feeder.run(Duration::from_secs(60)); // fetch -> push every 60s, forever
```

## How it works

```
                 ┌── PriceSource ──┐      ┌──── doppler-sdk ────┐
 every interval: │ Coinbase.spot() │  ->  │ Builder.add_update  │ -> Solana tx -> oracle account
                 │ "172.34" -> u64 │      │ seq = push-millis   │
                 └─────────────────┘      └─────────────────────┘
```

- **`source.rs`** — `PriceSource` trait + a keyless `Coinbase` USD-spot source.
  `parse_decimal_to_minor` converts a decimal string to integer minor units
  (6 decimals) **without floating point**. Swap in Binance / tokens.xyz / a CEX by
  implementing the trait; nothing else changes.
- **`lib.rs`** — `Feeder::tick()` pushes one fresh price per `Feed`; a feed that
  fails (source down, RPC error) is **skipped, never pushed stale**. `Feeder::run()`
  loops on an interval. The on-chain sequence is push-time millis
  (`.max(current + 1)`), which is monotonic (the program rejects `new <= current`)
  and doubles as a freshness stamp.

## Run the POC (local surfpool)

```bash
# 1. start the local validator with the example oracle accounts loaded
./surfpool.sh

# 2. feed the example SOL-USDC oracle the live Coinbase SOL price every 60s
cargo run --bin feeder
```

Expected output:

```
doppler feeder: 1 feed(s) every 60s -> http://localhost:8899
tick @ 1782489...
  SOL   $172.34       seq=1782489...  3MLXk7YCsq...
  1/1 feeds updated
```

Read the oracle account back (or use `examples/single-price-feed`) to confirm the
sequence advanced and the price matches the live market.

### Config (env vars, no flags yet)

| var | default | meaning |
|-----|---------|---------|
| `DOPPLER_RPC` | `http://localhost:8899` | Solana RPC endpoint |
| `DOPPLER_ADMIN` | `examples/keys/admin-keypair.json` | program admin keypair |
| `DOPPLER_INTERVAL_SECS` | `60` | push interval |

## What this is / is NOT

This is a **single-source price cache you operate yourself**, not a trustless oracle:
no quorum, no cross-source validation, no economic security. The price is only as
good as the source and the operator. Consumers must guard staleness on read.

## Handoff TODO (next slices)

1. **`clap` CLI** — `doppler init` (create the oracle account(s) via
   `create_account_with_seed`, admin as base) and `doppler run`. This replaces the
   hardcoded demo config in `main.rs` and unlocks **BTC/ETH/SOL** by creating three
   accounts instead of reusing the one example SOL account.
2. **More sources** behind `PriceSource` — Binance, tokens.xyz (needs API key + ToS
   check on on-chain redistribution).
3. **Priority fees** — replace the static `unit_price` with a dynamic estimate
   (`getRecentPrioritizationFees`) for mainnet.
4. **TS SDK** — mirror `createFeed().run()` for web devs.
5. **Mainnet** — real admin keypair, user-supplied RPC, low-balance alerting.
