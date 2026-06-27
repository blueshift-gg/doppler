//! Minimal `doppler feeder` runner.
//!
//! For the local surfpool demo this needs no flags: it feeds the example
//! SOL-USDC oracle with the live Coinbase SOL price every 60s, signing with the
//! example admin keypair. Override with env vars:
//!   DOPPLER_RPC=<url>  DOPPLER_ADMIN=<keypair.json>  DOPPLER_INTERVAL_SECS=<n>
//!
//! A proper `clap` CLI (`doppler init` / `doppler run`) is the next slice.

use std::path::PathBuf;
use std::time::Duration;

use doppler_feeder::{Coinbase, Feed, Feeder};
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::EncodableKey as _;

fn main() {
    let rpc_url =
        std::env::var("DOPPLER_RPC").unwrap_or_else(|_| "http://localhost:8899".to_string());

    let interval_secs: u64 = std::env::var("DOPPLER_INTERVAL_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(60);
    let interval = Duration::from_secs(interval_secs);

    let unit_price: u64 = 1_000;

    // Admin keypair the program expects. Defaults to the example key for surfpool.
    let admin_path: PathBuf = std::env::var("DOPPLER_ADMIN").map_or_else(
        |_| {
            [
                env!("CARGO_MANIFEST_DIR"),
                "..",
                "examples",
                "keys",
                "admin-keypair.json",
            ]
            .iter()
            .collect()
        },
        PathBuf::from,
    );
    let admin = Keypair::read_from_file(&admin_path)
        .unwrap_or_else(|e| panic!("admin keypair not found at {}: {e}", admin_path.display()));

    // symbol -> oracle account. Demo: the example SOL-USDC oracle, fed live SOL-USD.
    let feeds = vec![Feed::new(
        "SOL",
        Pubkey::from_str_const("QUVF91dzXWYvE5FmFEc41JZxRDmNgx8S8P6sNDWYZiW"),
    )];

    let feeder = Feeder::new(&rpc_url, admin, Coinbase::usd(), feeds, unit_price);
    println!(
        "doppler feeder: {} feed(s) every {}s -> {rpc_url}",
        feeder.feed_count(),
        interval_secs
    );
    feeder.run(interval);
}
