//! Native tokens.xyz "assets API" source.
//!
//! tokens.xyz models the world as **asset -> variants -> market metrics**: one
//! canonical asset (`"bitcoin"`) has many on-chain variants (cbBTC, wBTC, ...),
//! each a distinct mint with its own market block, tagged with `trustTier` /
//! `liquidityTier` and an `executionQuality.isEligibleForPrimary` flag.
//!
//! Selection has three axes:
//! - **which assets**  — [`Assets::List`] or [`Assets::All`]
//! - **which variant** — [`Variant`]: a single variant ([`Variant::Primary`],
//!   [`Variant::Mint`], [`Variant::All`]) or an aggregate ([`Variant::Median`],
//!   the median across the trust tiers you allow)
//! - **which metric**  — [`FeedType::Spot`] today
//!
//! ```no_run
//! use doppler_feeder::{TokensXyz, Assets, Variant, Tier};
//! let src = TokensXyz::new("API_KEY")
//!     .assets(Assets::list(["bitcoin", "ethereum", "solana"]))
//!     .variant(Variant::Median(vec![Tier::Tier1, Tier::Tier2])); // mediated price
//! let quotes = src.resolve(6).unwrap();
//! ```

use std::cmp::Ordering;
use std::time::Duration;

use serde_json::Value;

use crate::source::{aggregate, scalar_to_minor, Aggregate};

/// Endpoint base. Exact host/path + auth still need confirming against the live
/// assets-api; override with [`TokensXyz::with_base_url`].
pub const DEFAULT_BASE_URL: &str = "https://api.tokens.xyz";

/// Which assets to feed.
pub enum Assets {
    /// Every asset tokens.xyz serves. Requires the list endpoint (see `resolve`).
    All,
    /// A specific set of asset ids, e.g. `["bitcoin", "ethereum", "solana"]`.
    List(Vec<String>),
}

impl Assets {
    /// Build [`Assets::List`] from anything string-like.
    pub fn list<I, S>(ids: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        Assets::List(ids.into_iter().map(Into::into).collect())
    }
}

/// tokens.xyz trust/liquidity tier.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tier {
    Tier1,
    Tier2,
    Tier3,
}

impl Tier {
    const fn as_str(self) -> &'static str {
        match self {
            Tier::Tier1 => "tier1",
            Tier::Tier2 => "tier2",
            Tier::Tier3 => "tier3",
        }
    }
}

/// Which variant(s) of an asset to price.
pub enum Variant {
    /// The canonical variant: `isEligibleForPrimary`, else tier1 trust+liquidity,
    /// else the deepest-liquidity variant. One feed per asset.
    Primary,
    /// A specific mint address. One feed.
    Mint(String),
    /// Every variant — each becomes its own feed.
    All,
    /// Median price across variants whose **trust tier** is in the allowed set.
    /// One mediated feed per asset; more manipulation-resistant than any single
    /// wrapper. Empty/over-restrictive tier sets yield no quote (skipped).
    Median(Vec<Tier>),
}

/// Which market metric goes on-chain.
pub enum FeedType {
    /// Spot USD price -> `PriceFeed { price }`.
    Spot,
    // Future: MarketData { price, volume, market_cap }, Supply, ...
}

/// A resolved price quote ready to push to a feed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Quote {
    /// Canonical asset id, e.g. `"bitcoin"`.
    pub asset_id: String,
    /// Human label, e.g. `"cbBTC"` or `"bitcoin median[tier1+tier2]"`.
    pub label: String,
    /// Identity used to derive the oracle account: the mint for a single variant,
    /// or the asset id for an aggregate (median).
    pub key: String,
    /// Price in minor units (scaled by `10^decimals`).
    pub price: u64,
}

/// Native tokens.xyz source.
pub struct TokensXyz {
    client: reqwest::blocking::Client,
    base_url: String,
    api_key: String,
    assets: Assets,
    variant: Variant,
    feed: FeedType,
}

impl TokensXyz {
    /// New source with the default base URL, an empty asset list, `Variant::Primary`,
    /// and `FeedType::Spot`.
    #[must_use]
    pub fn new(api_key: impl Into<String>) -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("doppler-feeder")
            .build()
            .expect("failed to build http client");
        Self {
            client,
            base_url: DEFAULT_BASE_URL.to_string(),
            api_key: api_key.into(),
            assets: Assets::List(Vec::new()),
            variant: Variant::Primary,
            feed: FeedType::Spot,
        }
    }

    #[must_use]
    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into();
        self
    }

    #[must_use]
    pub fn assets(mut self, assets: Assets) -> Self {
        self.assets = assets;
        self
    }

    #[must_use]
    pub fn variant(mut self, variant: Variant) -> Self {
        self.variant = variant;
        self
    }

    #[must_use]
    pub fn feed(mut self, feed: FeedType) -> Self {
        self.feed = feed;
        self
    }

    /// Resolve the current selection into concrete [`Quote`]s, scaling prices to
    /// `decimals`. One request per asset; `Assets::All` first needs the list-assets
    /// endpoint (not yet wired).
    pub fn resolve(&self, decimals: u32) -> Result<Vec<Quote>, String> {
        let FeedType::Spot = &self.feed; // only metric supported today
        let asset_ids = match &self.assets {
            Assets::List(ids) => ids.clone(),
            Assets::All => self.list_all_assets()?,
        };
        let mut quotes = Vec::new();
        for id in &asset_ids {
            let asset = self.fetch_asset(id)?;
            quotes.extend(select_quotes(&asset, &self.variant, decimals));
        }
        Ok(quotes)
    }

    /// Fetch one asset's variants document. Path + auth are assumptions to confirm
    /// against the live API; isolated here so the finisher changes one place.
    fn fetch_asset(&self, asset_id: &str) -> Result<Value, String> {
        let url = format!("{}/assets/{asset_id}", self.base_url); // TODO confirm exact path
        self.client
            .get(&url)
            .bearer_auth(&self.api_key) // TODO confirm auth scheme (bearer vs x-api-key)
            .send()
            .map_err(|e| format!("request failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("http error: {e}"))?
            .json()
            .map_err(|e| format!("bad json: {e}"))
    }

    /// `Assets::All` needs the list-assets endpoint to enumerate the universe.
    /// Wire it once the path is known; ship `Assets::List` first.
    fn list_all_assets(&self) -> Result<Vec<String>, String> {
        Err("Assets::All not wired yet: need the list-assets endpoint + pagination".to_string())
    }
}

/// Select quotes from one asset document per `variant`, scaling price to `decimals`.
#[must_use]
pub fn select_quotes(asset: &Value, variant: &Variant, decimals: u32) -> Vec<Quote> {
    let asset_id = asset["assetId"].as_str().unwrap_or_default();
    let empty = Vec::new();
    let variants = asset["variants"].as_array().unwrap_or(&empty);

    match variant {
        Variant::All => variants
            .iter()
            .filter_map(|v| single_quote(asset_id, v, decimals))
            .collect(),
        Variant::Mint(m) => variants
            .iter()
            .filter(|v| v["mint"].as_str() == Some(m.as_str()))
            .filter_map(|v| single_quote(asset_id, v, decimals))
            .collect(),
        Variant::Primary => pick_primary(variants)
            .and_then(|v| single_quote(asset_id, v, decimals))
            .into_iter()
            .collect(),
        Variant::Median(tiers) => median_quote(asset_id, variants, tiers, decimals)
            .into_iter()
            .collect(),
    }
}

/// Pick the canonical variant: `isEligibleForPrimary`, else tier1 trust+liquidity,
/// else the deepest-liquidity variant.
#[must_use]
pub fn pick_primary(variants: &[Value]) -> Option<&Value> {
    variants
        .iter()
        .find(|v| v["executionQuality"]["isEligibleForPrimary"].as_bool() == Some(true))
        .or_else(|| {
            variants.iter().find(|v| {
                v["trustTier"].as_str() == Some("tier1")
                    && v["liquidityTier"].as_str() == Some("tier1")
            })
        })
        .or_else(|| {
            variants
                .iter()
                .max_by(|a, b| liquidity(a).partial_cmp(&liquidity(b)).unwrap_or(Ordering::Equal))
        })
}

/// Median price across variants whose trust tier is allowed. One quote per asset.
fn median_quote(asset_id: &str, variants: &[Value], tiers: &[Tier], decimals: u32) -> Option<Quote> {
    let prices: Vec<u64> = variants
        .iter()
        .filter(|v| tier_allowed(v, tiers))
        .filter_map(|v| scalar_to_minor(&v["market"]["price"], decimals))
        .collect();
    let price = aggregate(&prices, Aggregate::Median)?;
    let label_tiers = tiers
        .iter()
        .map(|t| t.as_str())
        .collect::<Vec<_>>()
        .join("+");
    Some(Quote {
        asset_id: asset_id.to_string(),
        label: format!("{asset_id} median[{label_tiers}]"),
        key: asset_id.to_string(),
        price,
    })
}

fn tier_allowed(v: &Value, tiers: &[Tier]) -> bool {
    v["trustTier"]
        .as_str()
        .is_some_and(|t| tiers.iter().any(|x| x.as_str() == t))
}

fn liquidity(v: &Value) -> f64 {
    v["market"]["liquidity"].as_f64().unwrap_or(0.0)
}

fn single_quote(asset_id: &str, v: &Value, decimals: u32) -> Option<Quote> {
    let price = scalar_to_minor(&v["market"]["price"], decimals)?;
    Some(Quote {
        asset_id: asset_id.to_string(),
        label: v["symbol"].as_str().unwrap_or_default().to_string(),
        key: v["mint"].as_str()?.to_string(),
        price,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Trimmed real tokens.xyz response for "bitcoin": cbBTC is the primary
    // (tier1 + isEligibleForPrimary), wBTC is tier2.
    const BITCOIN: &str = r#"{
      "assetId": "bitcoin",
      "variants": [
        {
          "variantId": "bitcoin:cbBTC",
          "mint": "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij",
          "symbol": "cbBTC",
          "market": { "price": 60333.52527692134, "liquidity": 22289268.62, "decimals": 8 },
          "executionQuality": { "isEligibleForPrimary": true },
          "liquidityTier": "tier1",
          "trustTier": "tier1"
        },
        {
          "variantId": "bitcoin:wBTC",
          "mint": "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
          "symbol": "wBTC",
          "market": { "price": 60219.1949427377, "liquidity": 4569240.93, "decimals": 8 },
          "executionQuality": null,
          "liquidityTier": "tier2",
          "trustTier": "tier2"
        }
      ]
    }"#;

    fn doc() -> Value {
        serde_json::from_str(BITCOIN).unwrap()
    }

    #[test]
    fn primary_picks_canonical_variant_and_scales_price() {
        let q = select_quotes(&doc(), &Variant::Primary, 6);
        assert_eq!(q.len(), 1);
        assert_eq!(q[0].label, "cbBTC");
        assert_eq!(q[0].key, "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij");
        // 60333.52527692134 truncated to 6 decimals -> 60_333_525_276
        assert_eq!(q[0].price, 60_333_525_276);
    }

    #[test]
    fn all_returns_every_variant() {
        let q = select_quotes(&doc(), &Variant::All, 6);
        assert_eq!(q.len(), 2);
        assert_eq!(q[1].label, "wBTC");
        assert_eq!(q[1].price, 60_219_194_942);
    }

    #[test]
    fn mint_selects_one() {
        let q = select_quotes(
            &doc(),
            &Variant::Mint("3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh".to_string()),
            6,
        );
        assert_eq!(q.len(), 1);
        assert_eq!(q[0].label, "wBTC");
    }

    #[test]
    fn median_across_tiers_mediates_price() {
        // median of cbBTC (60_333_525_276) and wBTC (60_219_194_942) = mean of the two
        let q = select_quotes(&doc(), &Variant::Median(vec![Tier::Tier1, Tier::Tier2]), 6);
        assert_eq!(q.len(), 1);
        assert_eq!(q[0].key, "bitcoin"); // aggregate keyed by asset, not a mint
        assert_eq!(q[0].price, 60_276_360_109);
    }

    #[test]
    fn median_respects_tier_allowlist() {
        // tier1 only -> just cbBTC
        let q = select_quotes(&doc(), &Variant::Median(vec![Tier::Tier1]), 6);
        assert_eq!(q.len(), 1);
        assert_eq!(q[0].price, 60_333_525_276);
        // tier3 only -> no allowed variants -> no quote
        let none = select_quotes(&doc(), &Variant::Median(vec![Tier::Tier3]), 6);
        assert!(none.is_empty());
    }

    #[test]
    fn primary_falls_back_to_tier1_without_exec_quality() {
        let doc: Value = serde_json::from_str(
            r#"{"assetId":"x","variants":[
                {"variantId":"x:a","mint":"A","symbol":"A","market":{"price":"1.5","liquidity":1},"liquidityTier":"tier2","trustTier":"tier2"},
                {"variantId":"x:b","mint":"B","symbol":"B","market":{"price":"2.0","liquidity":2},"liquidityTier":"tier1","trustTier":"tier1"}
            ]}"#,
        )
        .unwrap();
        let q = select_quotes(&doc, &Variant::Primary, 6);
        assert_eq!(q.len(), 1);
        assert_eq!(q[0].label, "B");
    }
}
