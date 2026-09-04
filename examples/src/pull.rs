//! A pull feed: deploy SOL/USD with the pull path, sign an update off chain as the admin, and
//! land it from another key, the relayer, who pays. `RPC_URL` as in deploy.rs.

use doppler_sdk::{
    doppler::{Field, Manifest, Price, Ty},
    now_ms, DopplerClient, Reading, SendOptions,
};
use solana_client::rpc_client::RpcClient;
use solana_keypair::Keypair;
use solana_signer::{EncodableKey as _, Signer as _};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let rpc = RpcClient::new(
        std::env::var("RPC_URL").unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".into()),
    );
    let keys = concat!(env!("CARGO_MANIFEST_DIR"), "/keys/");
    let admin = Keypair::read_from_file(format!("{keys}admin-keypair.json"))?;
    let relayer = Keypair::read_from_file(format!("{keys}relayer-keypair.json"))?;
    let doppler = DopplerClient::<Price>::load(
        Manifest {
            admin: admin.pubkey().to_bytes(),
            seed: "SOL/USD pull".into(),
            pull: true,
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

    if rpc.get_account(&doppler.address()).is_err() {
        for signature in doppler.deploy().send(&[&admin])? {
            println!("deploy {signature}");
        }
    }

    // The admin's side: sign, and publish the bytes wherever relayers fetch them.
    let price = Price {
        price: 17_234_000_000,
        conf: 5_000_000,
        expo: -8,
    };
    let signed = doppler.update(now_ms(), &price).sign(&admin)?.signed;

    // The relayer's side: the bytes and a key that pays.
    let signature = doppler.pull(&signed)?.send(&[&relayer])?;
    println!("pulled in {signature}");

    let Reading {
        sequence,
        value: Price { price, conf, expo },
    } = doppler.read()?;
    println!("SOL/USD = {price}e{expo} ± {conf}e{expo} at {sequence} ms");
    Ok(())
}
