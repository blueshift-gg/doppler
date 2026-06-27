//! Doppler feeder: fetch real prices and push them to a Doppler oracle on an
//! interval, using the existing [`doppler_sdk`] transaction builder.
//!
//! This is the off-chain half of Doppler: the on-chain program and SDK already
//! make a single update ~5 lines of code. The feeder wraps that in a price
//! [`source::PriceSource`] + a [`Feeder::run`] loop so the dumbest dev can keep a
//! live feed running with one call.

use std::mem::size_of;
use std::thread::sleep;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use doppler_program::PriceFeed;
use doppler_sdk::{transaction::Builder, Oracle};
use solana_client::rpc_client::RpcClient;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;

pub mod raw;
pub mod source;
pub mod tokens;
pub use raw::RawSource;
pub use source::{aggregate, scalar_to_minor, Aggregate, Binance, Coinbase, PriceSource};
pub use tokens::{Assets, FeedType, Quote, Tier, TokensXyz, Variant};

/// Decimals encoded into the on-chain `u64` price (USDC-style, matches the README).
pub const PRICE_DECIMALS: u32 = 6;

/// A single feed the feeder keeps fresh: a human symbol and the oracle account it writes to.
pub struct Feed {
    /// Source symbol, e.g. `"SOL"`.
    pub symbol: String,
    /// The on-chain oracle account this symbol's price is written to.
    pub oracle: Pubkey,
}

impl Feed {
    /// Convenience constructor.
    #[must_use]
    pub fn new(symbol: impl Into<String>, oracle: Pubkey) -> Self {
        Self {
            symbol: symbol.into(),
            oracle,
        }
    }
}

/// A successful single-feed push.
pub struct Update {
    /// Price written, in minor units (scaled by `10^PRICE_DECIMALS`).
    pub price: u64,
    /// Monotonic sequence stamped on-chain (push-time millis).
    pub sequence: u64,
    /// Confirmed transaction signature.
    pub signature: String,
}

/// Drives a set of [`Feed`]s: fetch prices from `source` and push them on-chain
/// with the hardcoded program admin keypair.
pub struct Feeder<S: PriceSource> {
    client: RpcClient,
    admin: Keypair,
    source: S,
    feeds: Vec<Feed>,
    unit_price: u64,
}

impl<S: PriceSource> Feeder<S> {
    /// Build a feeder. `admin` must be the keypair the deployed program expects.
    /// `unit_price` is the priority fee in micro-lamports per compute unit.
    #[must_use]
    pub fn new(rpc_url: &str, admin: Keypair, source: S, feeds: Vec<Feed>, unit_price: u64) -> Self {
        Self {
            client: RpcClient::new(rpc_url.to_string()),
            admin,
            source,
            feeds,
            unit_price,
        }
    }

    /// Number of feeds this feeder manages.
    #[must_use]
    pub fn feed_count(&self) -> usize {
        self.feeds.len()
    }

    /// Push one fresh price for every feed. A feed that fails (source down, RPC
    /// error) is skipped and logged, never pushed stale. Returns how many feeds
    /// were successfully updated this tick.
    pub fn tick(&self) -> usize {
        let mut updated = 0;
        for feed in &self.feeds {
            match self.update_feed(feed) {
                Ok(u) => {
                    println!(
                        "  {:<5} ${:<12} seq={}  {}",
                        feed.symbol,
                        format_minor(u.price, PRICE_DECIMALS),
                        u.sequence,
                        u.signature
                    );
                    updated += 1;
                }
                Err(e) => eprintln!("  {:<5} skipped: {e}", feed.symbol),
            }
        }
        updated
    }

    /// Fetch + push a single feed. Returns the [`Update`] on success.
    fn update_feed(&self, feed: &Feed) -> Result<Update, String> {
        // 1. Fetch the live price. On failure, propagate so the feed is skipped.
        let price = self.source.price_minor(&feed.symbol, PRICE_DECIMALS)?;

        // 2. Read the current sequence so the new one is strictly greater. The
        //    program rejects `new <= current`. Push-time millis is monotonic and
        //    doubles as a freshness stamp; `.max(current + 1)` guards against a
        //    clock skew or a pre-seeded account sequence.
        let expected = size_of::<Oracle<PriceFeed>>();
        let current = self
            .client
            .get_account_data(&feed.oracle)
            .ok()
            .filter(|data| data.len() == expected)
            .map(|data| Oracle::<PriceFeed>::from_bytes(data.as_slice()).sequence)
            .unwrap_or(0);
        let sequence = now_millis().max(current + 1);

        // 3. Build + send with the existing SDK builder.
        let blockhash = self
            .client
            .get_latest_blockhash()
            .map_err(|e| format!("blockhash: {e}"))?;
        let tx = Builder::new(&self.admin)
            .add_oracle_update(
                feed.oracle,
                Oracle {
                    sequence,
                    payload: PriceFeed { price },
                },
            )
            .with_unit_price(self.unit_price)
            .build(blockhash);

        let signature = self
            .client
            .send_and_confirm_transaction(&tx)
            .map_err(|e| format!("send: {e}"))?
            .to_string();
        Ok(Update {
            price,
            sequence,
            signature,
        })
    }

    /// Run forever, pushing every `interval`. Blocks the calling thread.
    pub fn run(&self, interval: Duration) -> ! {
        loop {
            println!("tick @ {}", now_millis());
            let n = self.tick();
            println!("  {n}/{} feeds updated\n", self.feeds.len());
            sleep(interval);
        }
    }
}

/// Current unix time in milliseconds, used as the monotonic oracle sequence.
#[must_use]
pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Format an integer minor-unit price back to a human decimal string for display,
/// e.g. `format_minor(172_340_000, 6) == "172.34"`. Keeps at least 2 decimals.
#[must_use]
pub fn format_minor(value: u64, decimals: u32) -> String {
    if decimals == 0 {
        return value.to_string();
    }
    let scale = 10u64.pow(decimals);
    let int = value / scale;
    let frac = value % scale;
    let mut frac_str = format!("{frac:0>width$}", width = decimals as usize);
    while frac_str.len() > 2 && frac_str.ends_with('0') {
        frac_str.pop();
    }
    format!("{int}.{frac_str}")
}

#[cfg(test)]
mod tests {
    use super::format_minor;

    #[test]
    fn formats_with_trailing_trim() {
        assert_eq!(format_minor(172_340_000, 6), "172.34");
        assert_eq!(format_minor(42_000_000_000, 6), "42000.00");
        assert_eq!(format_minor(100_000, 6), "0.10");
    }

    #[test]
    fn zero_decimals_passthrough() {
        assert_eq!(format_minor(42_000, 0), "42000");
    }
}
