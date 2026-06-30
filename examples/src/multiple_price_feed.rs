use doppler_program::PriceFeed;
use doppler_sdk::{transaction::Builder, Oracle};
use solana_client::rpc_client::RpcClient;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::{EncodableKey as _, Signer};
use std::path::PathBuf;

mod constants;
mod fetch;

fn main() {
    // Connect to local Solana cluster
    let rpc_url = "http://localhost:8899";
    let client = RpcClient::new(rpc_url.to_string());

    let keypair_path: PathBuf = [env!("CARGO_MANIFEST_DIR"), "keys", "admin-keypair.json"]
        .iter()
        .collect();

    // fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm
    let program_id: Pubkey = Pubkey::new_from_array([
        0x09, 0xe2, 0x60, 0x40, 0xff, 0x10, 0xec, 0xcf, 0xc1, 0x6a, 0xf6, 0x16, 0x9a, 0x68, 0x04,
        0x78, 0x15, 0x14, 0x33, 0x02, 0xac, 0x6e, 0x98, 0x5f, 0x70, 0x85, 0x53, 0xe1, 0x0a, 0xb6,
        0xf9, 0x22,
    ]);

    // Load admin keypair (ensure this path is correct)
    let admin = Keypair::read_from_file(keypair_path).expect("keypair not found at that path");

    // Define oracle account public key (replace with actual oracle account)

    let sol_usdc_oracle_data =
        fetch::oracle_account::<PriceFeed>(&client, &constants::SOL_USDC_ORACLE)
            .expect("failed to fetch oracle account");
    let sol_usdt_oracle_data =
        fetch::oracle_account::<PriceFeed>(&client, &constants::SOL_USDT_ORACLE)
            .expect("failed to fetch oracle account");
    let bonk_sol_oracle_data =
        fetch::oracle_account::<PriceFeed>(&client, &constants::BONK_SOL_ORACLE)
            .expect("failed to fetch oracle account");

    // Create the new price feed data
    let new_sol_usdc_price_feed = PriceFeed {
        price: sol_usdc_oracle_data.payload.price + 10,
    };
    let new_sol_usdt_price_feed = PriceFeed {
        price: sol_usdt_oracle_data.payload.price + 10,
    };
    let new_bonk_sol_price_feed = PriceFeed {
        price: bonk_sol_oracle_data.payload.price + 10,
    };

    // Get a recent blockhash
    let recent_blockhash = client
        .get_latest_blockhash()
        .expect("Failed to get recent blockhash");

    // Create and sign the transaction
    let mut tx_builder = Builder::new(&client, program_id, admin.pubkey()).with_unit_price(1_000);

    // Add multiple oracle updates
    for (oracle_pubkey, oracle_data, new_price_feed) in [
        (
            constants::SOL_USDC_ORACLE,
            sol_usdc_oracle_data,
            new_sol_usdc_price_feed,
        ),
        (
            constants::SOL_USDT_ORACLE,
            sol_usdt_oracle_data,
            new_sol_usdt_price_feed,
        ),
        (
            constants::BONK_SOL_ORACLE,
            bonk_sol_oracle_data,
            new_bonk_sol_price_feed,
        ),
    ] {
        tx_builder = tx_builder.add_oracle_update(
            oracle_pubkey,
            Oracle {
                sequence: oracle_data.sequence + 1, // New sequence number, must be greater than current
                payload: new_price_feed,
            },
        );
    }

    let mut transaction = tx_builder.build(recent_blockhash);
    transaction.sign(&[&admin], recent_blockhash);
    println!("Sending Tx...");

    // Send the transaction
    let signature = client
        .send_and_confirm_transaction(&transaction)
        .expect("Failed to send transaction");

    println!("Transaction successful with signature: {signature:?}");

    let sol_usdc_oracle_data =
        fetch::oracle_account::<PriceFeed>(&client, &constants::SOL_USDC_ORACLE)
            .expect("failed to fetch sol-usdc oracle account");
    let sol_usdt_oracle_data =
        fetch::oracle_account::<PriceFeed>(&client, &constants::SOL_USDT_ORACLE)
            .expect("failed to fetch sol-usdt oracle account");
    let bonk_sol_oracle_data =
        fetch::oracle_account::<PriceFeed>(&client, &constants::BONK_SOL_ORACLE)
            .expect("failed to fetch bonk-sol oracle account");

    println!(
        "SOL/USDC Price feed : seq : {}, price : {}",
        sol_usdc_oracle_data.sequence, sol_usdc_oracle_data.payload.price
    );
    println!(
        "SOL/USDT Price feed : seq : {}, price : {}",
        sol_usdt_oracle_data.sequence, sol_usdt_oracle_data.payload.price
    );
    println!(
        "Bonk/SOL Price feed : seq : {}, price : {}",
        bonk_sol_oracle_data.sequence, bonk_sol_oracle_data.payload.price
    );
}
