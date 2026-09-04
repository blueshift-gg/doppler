//! Write SOL/USD to the feed from `target/doppler.json` and read it back.

use doppler_sdk::{doppler::Price, now_ms, DopplerClient, Reading, SendOptions};
use solana_client::rpc_client::RpcClient;
use solana_keypair::Keypair;
use solana_signer::EncodableKey as _;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let rpc = RpcClient::new(
        std::env::var("RPC_URL").unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".into()),
    );
    let admin = Keypair::read_from_file(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/keys/admin-keypair.json"
    ))?;
    let doppler = DopplerClient::<Price>::load(
        std::fs::read_to_string("target/doppler.json")?.parse()?,
        SendOptions {
            rpc: &rpc,
            unit_price: 1_000,
        },
    )?;

    let price = Price {
        price: 17_234_000_000,
        conf: 5_000_000,
        expo: -8,
    };
    let signature = doppler.update(now_ms(), &price).send(&[&admin])?;
    println!("sent {signature}");

    let Reading {
        sequence,
        value: Price { price, conf, expo },
    } = doppler.read()?;
    println!("SOL/USD = {price}e{expo} ± {conf}e{expo} at {sequence} ms");
    Ok(())
}
