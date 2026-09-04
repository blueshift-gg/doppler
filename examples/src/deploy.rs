//! Deploy a Price feed named SOL/USD and write its manifest to `target/doppler.json`.
//! `RPC_URL` overrides mainnet, for surfpool: `RPC_URL=http://localhost:8899`.

use doppler_sdk::{
    doppler::{Field, Manifest, Price, Ty},
    DopplerClient, SendOptions,
};
use solana_client::rpc_client::RpcClient;
use solana_keypair::Keypair;
use solana_signer::{EncodableKey as _, Signer as _};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let rpc = RpcClient::new(
        std::env::var("RPC_URL").unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".into()),
    );
    let admin = Keypair::read_from_file(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/keys/admin-keypair.json"
    ))?;
    let doppler = DopplerClient::<Price>::load(
        Manifest {
            admin: admin.pubkey().to_bytes(),
            seed: "SOL/USD".into(),
            pull: false,
            fields: vec![
                Field {
                    name: "price".into(),
                    ty: Ty::I64,
                    len: 1,
                },
                Field {
                    name: "conf".into(),
                    ty: Ty::U64,
                    len: 1,
                },
                Field {
                    name: "expo".into(),
                    ty: Ty::I32,
                    len: 1,
                },
            ],
        },
        SendOptions {
            rpc: &rpc,
            unit_price: 1_000,
        },
    )?;

    for signature in doppler.deploy().send(&[&admin])? {
        println!("deploy {signature}");
    }
    std::fs::write("target/doppler.json", doppler.manifest.to_string())?;
    println!("program {} feed {}", doppler.program(), doppler.address());
    Ok(())
}
