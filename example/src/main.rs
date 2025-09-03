use doppler::PriceFeed;
use doppler_sdk::{Oracle, UpdateInstruction};
use solana_client::rpc_client::RpcClient;
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::{EncodableKey as _, Signer};
use solana_transaction::Transaction;

const COMPUTE_BUDGET_IXS_CU_OVERHEAD: u32 = 3 * 150; // 3 compute budget ixs * 150 CU each
const DATA_SIZE_OVERHEAD: u32 = 36 + 22 + 5 + 5 + 9 + 18; // doppler program + compute budget program + load ix + limit ix + price ix

fn main() {
    // Connect to local Solana cluster
    let rpc_url = "http://localhost:8899";
    let client = RpcClient::new(rpc_url.to_string());

    // Load admin keypair (ensure this path is correct)
    let admin = Keypair::read_from_file("./admin.json").expect("Failed to read keypair");

    println!("Admin Pubkey: {}", admin.pubkey());
    // Define oracle account public key (replace with actual oracle account)
    let oracle_pubkey = Pubkey::from_str_const("QUVF91dzXWYvE5FmFEc41JZxRDmNgx8S8P6sNDWYZiW");

    // Create the new price feed data
    let new_price_feed = PriceFeed { price: 123_456 };

    // Create the update instruction
    let update_instruction = UpdateInstruction {
        admin: admin.pubkey(),
        oracle_pubkey,
        oracle: Oracle {
            sequence: 100_511, // New sequence number, must be greater than current
            payload: new_price_feed,
        },
    };

    let data_size = update_instruction.loaded_accounts_data_size_limit() * 2 // loaded state + update state ix data (same size)
        + DATA_SIZE_OVERHEAD;

    println!("Data Size Limit: {}", data_size);
    // Create transaction with compute budget instructions
    let instructions = [
        ComputeBudgetInstruction::set_compute_unit_price(1_000),
        ComputeBudgetInstruction::set_compute_unit_limit(
            update_instruction.compute_unit_limit() + COMPUTE_BUDGET_IXS_CU_OVERHEAD,
        ),
        ComputeBudgetInstruction::set_loaded_accounts_data_size_limit(data_size + 18),
        update_instruction.into(),
    ];

    // Get a recent blockhash
    let recent_blockhash = client
        .get_latest_blockhash()
        .expect("Failed to get recent blockhash");

    println!("Recent Blockhash: {:?}", recent_blockhash);
    // Create and sign the transaction
    let transaction = Transaction::new_signed_with_payer(
        &instructions,
        Some(&admin.pubkey()),
        &[&admin],
        recent_blockhash,
    );

    // Send the transaction
    let signature = client
        .send_and_confirm_transaction(&transaction)
        .expect("Failed to send transaction");

    println!("Transaction successful with signature: {:?}", signature);
}
