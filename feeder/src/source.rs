//! Price sources for the feeder.
//!
//! A [`PriceSource`] turns a human symbol (`"SOL"`) into an integer price scaled
//! to a fixed number of decimals. Sources never return a stale or guessed value:
//! on any failure they return `Err` and the feeder skips the tick rather than
//! pushing bad data on-chain.

use std::time::Duration;

use serde_json::Value;

/// A source of spot prices, keyed by a human symbol such as `"SOL"`.
pub trait PriceSource {
    /// Fetch the latest price for `symbol`, returned as an integer scaled by
    /// `10^decimals` (e.g. `42000.50` at 6 decimals -> `42_000_500_000`).
    ///
    /// Returns `Err` on any network, parse, or validation failure so the caller
    /// can skip the update instead of writing stale/garbage data.
    fn price_minor(&self, symbol: &str, decimals: u32) -> Result<u64, String>;
}

/// Coinbase public spot price (`/v2/prices/{BASE}-{QUOTE}/spot`). Keyless and
/// US-reachable. Maps `"SOL"` -> `SOL-USD`, `"BTC"` -> `BTC-USD`, etc.
pub struct Coinbase {
    client: reqwest::blocking::Client,
    quote: String,
}

impl Coinbase {
    /// USD-quoted Coinbase source with a 10s request timeout.
    #[must_use]
    pub fn usd() -> Self {
        Self::new("USD")
    }

    /// Build a Coinbase source quoted in `quote` (e.g. `"USD"`).
    #[must_use]
    pub fn new(quote: &str) -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("doppler-feeder")
            .build()
            .expect("failed to build http client");
        Self {
            client,
            quote: quote.to_string(),
        }
    }
}

impl PriceSource for Coinbase {
    fn price_minor(&self, symbol: &str, decimals: u32) -> Result<u64, String> {
        let url = format!(
            "https://api.coinbase.com/v2/prices/{symbol}-{}/spot",
            self.quote
        );
        let body: serde_json::Value = self
            .client
            .get(&url)
            .send()
            .map_err(|e| format!("request failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("http error: {e}"))?
            .json()
            .map_err(|e| format!("bad json: {e}"))?;

        let amount = body["data"]["amount"]
            .as_str()
            .ok_or_else(|| format!("missing data.amount in response: {body}"))?;

        parse_decimal_to_minor(amount, decimals)
            .ok_or_else(|| format!("unparseable amount {amount:?}"))
    }
}

/// Binance public ticker price (`/api/v3/ticker/price?symbol={BASE}{QUOTE}`). Keyless.
/// Verified shape: `{"symbol":"BTCUSDT","price":"60412.00000000"}`.
///
/// `api.binance.com` is geo-restricted in some regions (incl. the US): use
/// [`Binance::with_base_url`] with `https://data-api.binance.vision` (public market
/// data) or `https://api.binance.us` if needed. Quote defaults to `USDT` — Binance
/// has no USD spot pairs.
pub struct Binance {
    client: reqwest::blocking::Client,
    base_url: String,
    quote: String,
}

impl Binance {
    /// USDT-quoted Binance source with a 10s request timeout.
    #[must_use]
    pub fn usdt() -> Self {
        Self::new("USDT")
    }

    /// Build a Binance source quoted in `quote` (e.g. `"USDT"`, `"USDC"`).
    #[must_use]
    pub fn new(quote: &str) -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("doppler-feeder")
            .build()
            .expect("failed to build http client");
        Self {
            client,
            base_url: "https://api.binance.com".to_string(),
            quote: quote.to_string(),
        }
    }

    /// Override the API base, e.g. `https://data-api.binance.vision` or `https://api.binance.us`.
    #[must_use]
    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into();
        self
    }
}

impl PriceSource for Binance {
    fn price_minor(&self, symbol: &str, decimals: u32) -> Result<u64, String> {
        let pair = format!("{}{}", symbol.to_uppercase(), self.quote);
        let url = format!("{}/api/v3/ticker/price?symbol={pair}", self.base_url);
        let body: Value = self
            .client
            .get(&url)
            .send()
            .map_err(|e| format!("request failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("http error: {e}"))?
            .json()
            .map_err(|e| format!("bad json: {e}"))?;
        let price = body["price"]
            .as_str()
            .ok_or_else(|| format!("missing price in response: {body}"))?;
        parse_decimal_to_minor(price, decimals)
            .ok_or_else(|| format!("unparseable price {price:?}"))
    }
}

/// Convert a decimal string like `"42000.57"` into integer minor units scaled by
/// `10^decimals`, without floating point. Extra fractional precision is truncated
/// (floored). Returns `None` for anything that is not a plain non-negative decimal.
#[must_use]
pub fn parse_decimal_to_minor(s: &str, decimals: u32) -> Option<u64> {
    let s = s.trim();
    let (int_part, frac_part) = match s.split_once('.') {
        Some((i, f)) => (i, f),
        None => (s, ""),
    };
    if int_part.is_empty() && frac_part.is_empty() {
        return None;
    }
    if !int_part.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if !frac_part.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }

    let want = decimals as usize;
    let mut frac = String::with_capacity(want);
    for (i, b) in frac_part.bytes().enumerate() {
        if i == want {
            break; // truncate extra precision
        }
        frac.push(b as char);
    }
    while frac.len() < want {
        frac.push('0'); // pad missing precision
    }

    let combined = format!("{int_part}{frac}");
    // Strip leading zeros are fine for u64::from_str; empty int_part means "0".
    combined.parse::<u64>().ok()
}

/// Read a JSON scalar (number or decimal string) as integer minor units, scaled by
/// `10^decimals`. Numbers are formatted to fixed decimals first (no scientific
/// notation, no float *arithmetic* on the value we keep).
#[must_use]
pub fn scalar_to_minor(v: &Value, decimals: u32) -> Option<u64> {
    match v {
        Value::String(s) => parse_decimal_to_minor(s, decimals),
        Value::Number(n) => {
            let f = n.as_f64()?;
            if !f.is_finite() || f < 0.0 {
                return None;
            }
            parse_decimal_to_minor(&format!("{f:.prec$}", prec = decimals as usize + 6), decimals)
        }
        _ => None,
    }
}

/// How to combine multiple prices into one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Aggregate {
    /// Take the first value as-is.
    First,
    /// Median (integer mean of the two middle values when the count is even).
    Median,
    /// Arithmetic mean (integer).
    Mean,
}

/// Combine prices (minor units) per `how`. `None` if the slice is empty.
#[must_use]
pub fn aggregate(prices: &[u64], how: Aggregate) -> Option<u64> {
    if prices.is_empty() {
        return None;
    }
    Some(match how {
        Aggregate::First => prices[0],
        Aggregate::Mean => {
            let sum: u128 = prices.iter().map(|&p| u128::from(p)).sum();
            (sum / prices.len() as u128) as u64
        }
        Aggregate::Median => {
            let mut p = prices.to_vec();
            p.sort_unstable();
            let mid = p.len() / 2;
            if p.len() % 2 == 1 {
                p[mid]
            } else {
                ((u128::from(p[mid - 1]) + u128::from(p[mid])) / 2) as u64
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{aggregate, parse_decimal_to_minor, scalar_to_minor, Aggregate};
    use serde_json::json;

    #[test]
    fn whole_number() {
        assert_eq!(parse_decimal_to_minor("42000", 6), Some(42_000_000_000));
    }

    #[test]
    fn with_fraction() {
        assert_eq!(parse_decimal_to_minor("42000.57", 6), Some(42_000_570_000));
    }

    #[test]
    fn pads_short_fraction() {
        assert_eq!(parse_decimal_to_minor("0.1", 6), Some(100_000));
    }

    #[test]
    fn truncates_extra_precision() {
        assert_eq!(parse_decimal_to_minor("0.123456789", 6), Some(123_456));
    }

    #[test]
    fn trims_whitespace() {
        assert_eq!(parse_decimal_to_minor("  12.5  ", 6), Some(12_500_000));
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(parse_decimal_to_minor("abc", 6), None);
        assert_eq!(parse_decimal_to_minor("", 6), None);
        assert_eq!(parse_decimal_to_minor("1.2.3", 6), None);
        assert_eq!(parse_decimal_to_minor("-5", 6), None);
    }

    #[test]
    fn zero_decimals() {
        assert_eq!(parse_decimal_to_minor("42000.99", 0), Some(42_000));
    }

    #[test]
    fn scalar_handles_numbers_and_strings() {
        assert_eq!(scalar_to_minor(&json!(60333.52527692134), 6), Some(60_333_525_276));
        assert_eq!(scalar_to_minor(&json!("172.34"), 6), Some(172_340_000));
        assert_eq!(scalar_to_minor(&json!(-1.0), 6), None);
        assert_eq!(scalar_to_minor(&json!(true), 6), None);
    }

    #[test]
    fn aggregate_modes() {
        assert_eq!(
            aggregate(&[3_000_000, 1_000_000, 2_000_000], Aggregate::Median),
            Some(2_000_000)
        );
        assert_eq!(aggregate(&[1_000_000, 3_000_000], Aggregate::Median), Some(2_000_000));
        assert_eq!(aggregate(&[1_000_000, 2_000_000, 6_000_000], Aggregate::Mean), Some(3_000_000));
        assert_eq!(aggregate(&[5, 9], Aggregate::First), Some(5));
        assert_eq!(aggregate(&[], Aggregate::Median), None);
    }
}
