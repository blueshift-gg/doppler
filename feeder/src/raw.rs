//! Generic "raw" JSON HTTP source: teach the feeder a new price API by config,
//! with no per-API Rust.
//!
//! Configure a URL template (`{asset}` / `{symbol}` are substituted), optional
//! headers / bearer auth, a **JSON Pointer** (RFC 6901, built into `serde_json`) to
//! the price, and how to aggregate when the pointer lands on an array of numbers.
//!
//! ```no_run
//! use doppler_feeder::{RawSource, Aggregate};
//! let src = RawSource::get("https://api.coinbase.com/v2/prices/{asset}-USD/spot")
//!     .select("/data/amount")
//!     .decimals(6);
//! let price = src.price("BTC").unwrap();
//! ```
//!
//! JSON Pointer reaches scalars and arrays-of-scalars. For a price buried in an
//! array of *objects* (e.g. pick the tier1 variants out of tokens.xyz), use the
//! native [`crate::TokensXyz`], or a JSONPath selector once that's added.

use std::time::Duration;

use serde_json::Value;

use crate::source::{aggregate, scalar_to_minor, Aggregate, PriceSource};

/// A config-driven JSON HTTP price source.
pub struct RawSource {
    client: reqwest::blocking::Client,
    url: String,
    headers: Vec<(String, String)>,
    bearer: Option<String>,
    pointer: String,
    aggregate: Aggregate,
    decimals: u32,
}

impl RawSource {
    /// Start a GET source against `url` (a template; `{asset}` is substituted).
    /// Defaults: no auth, empty pointer (set with `select`), `Aggregate::First`, 6 decimals.
    #[must_use]
    pub fn get(url: impl Into<String>) -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("doppler-feeder")
            .build()
            .expect("failed to build http client");
        Self {
            client,
            url: url.into(),
            headers: Vec::new(),
            bearer: None,
            pointer: String::new(),
            aggregate: Aggregate::First,
            decimals: 6,
        }
    }

    #[must_use]
    pub fn header(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.push((key.into(), value.into()));
        self
    }

    #[must_use]
    pub fn bearer(mut self, token: impl Into<String>) -> Self {
        self.bearer = Some(token.into());
        self
    }

    /// JSON Pointer to the price (a scalar, or an array of scalars to aggregate).
    #[must_use]
    pub fn select(mut self, pointer: impl Into<String>) -> Self {
        self.pointer = pointer.into();
        self
    }

    #[must_use]
    pub fn aggregate(mut self, how: Aggregate) -> Self {
        self.aggregate = how;
        self
    }

    #[must_use]
    pub fn decimals(mut self, decimals: u32) -> Self {
        self.decimals = decimals;
        self
    }

    /// Fetch and extract the price for `asset` (substituted into the URL template).
    pub fn price(&self, asset: &str) -> Result<u64, String> {
        let url = self.url.replace("{asset}", asset).replace("{symbol}", asset);
        let mut req = self.client.get(&url);
        for (key, value) in &self.headers {
            req = req.header(key, value);
        }
        if let Some(token) = &self.bearer {
            req = req.bearer_auth(token);
        }
        let body: Value = req
            .send()
            .map_err(|e| format!("request failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("http error: {e}"))?
            .json()
            .map_err(|e| format!("bad json: {e}"))?;
        pick(&body, &self.pointer, self.decimals, self.aggregate)
    }
}

impl PriceSource for RawSource {
    /// Uses the source's own configured decimals; the trait's `decimals` is ignored.
    fn price_minor(&self, symbol: &str, _decimals: u32) -> Result<u64, String> {
        self.price(symbol)
    }
}

/// Extract a price from an already-parsed body via JSON Pointer + aggregate.
/// Split out from the HTTP call so it can be tested without a network.
pub fn pick(body: &Value, pointer: &str, decimals: u32, how: Aggregate) -> Result<u64, String> {
    let node = body
        .pointer(pointer)
        .ok_or_else(|| format!("pointer {pointer:?} matched nothing"))?;
    let prices: Vec<u64> = match node {
        Value::Array(items) => items
            .iter()
            .filter_map(|x| scalar_to_minor(x, decimals))
            .collect(),
        scalar => scalar_to_minor(scalar, decimals).into_iter().collect(),
    };
    aggregate(&prices, how).ok_or_else(|| "no parseable price at pointer".to_string())
}

#[cfg(test)]
mod tests {
    use super::pick;
    use crate::source::Aggregate;
    use serde_json::json;

    #[test]
    fn scalar_pointer() {
        let body = json!({ "data": { "amount": "60333.52" } });
        assert_eq!(pick(&body, "/data/amount", 6, Aggregate::First), Ok(60_333_520_000));
    }

    #[test]
    fn array_of_strings_median() {
        let body = json!({ "prices": ["1.0", "2.0", "3.0"] });
        assert_eq!(pick(&body, "/prices", 6, Aggregate::Median), Ok(2_000_000));
    }

    #[test]
    fn array_of_numbers_mean() {
        let body = json!({ "p": [1.0, 2.0, 6.0] });
        assert_eq!(pick(&body, "/p", 6, Aggregate::Mean), Ok(3_000_000));
    }

    #[test]
    fn missing_pointer_errors() {
        let body = json!({ "data": {} });
        assert!(pick(&body, "/data/amount", 6, Aggregate::First).is_err());
    }
}
