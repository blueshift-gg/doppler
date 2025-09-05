use doppler::PriceFeed;
use doppler_sdk::{Oracle, UpdateInstruction};
use mollusk_svm::{program::keyed_account_for_system_program, Mollusk};
use mollusk_svm_bencher::MolluskComputeUnitBencher;
use solana_account::Account;
use solana_instruction::Instruction;
use solana_program::clock::Epoch;
use solana_pubkey::Pubkey;

pub fn keyed_account_for_admin(key: Pubkey) -> (Pubkey, Account) {
    (
        key,
        Account::new(10_000_000_000, 0, &solana_program::system_program::ID),
    )
}

pub fn keyed_account_for_oracle<T: Sized + Copy>(
    mollusk: &mut Mollusk,
    admin: Pubkey,
    seed: &str,
    payload: T,
) -> (Pubkey, Account) {
    let oracle_account = Oracle {
        sequence: 0,
        payload,
    };

    let key = Pubkey::create_with_seed(&admin, seed, &doppler_sdk::ID).unwrap();

    let lamports = mollusk
        .sysvars
        .rent
        .minimum_balance(core::mem::size_of::<Oracle<T>>());

    let data = oracle_account.to_bytes();

    let account = Account {
        lamports,
        data,
        owner: doppler_sdk::ID,
        executable: false,
        rent_epoch: Epoch::default(),
    };

    (key, account)
}

fn main() {
    // Create Mollusk instance
    let mut mollusk = Mollusk::new(&doppler_sdk::ID, "../target/deploy/doppler");

    let (oracle, oracle_account) = keyed_account_for_oracle::<PriceFeed>(
        &mut mollusk,
        doppler_admin::ADMIN.into(),
        "SOL/USDC",
        PriceFeed { price: 100_000 },
    );

    // Accounts
    let (system, system_account) = keyed_account_for_system_program();
    let (admin, admin_account) = keyed_account_for_admin(doppler_admin::ADMIN.into());

    // Create oracle account
    let create_price_feed_instruction =
        solana_program::system_instruction::create_account_with_seed(
            &admin,
            &oracle,
            &admin,
            "SOL/USDC",
            oracle_account.lamports,
            oracle_account.data.len() as u64,
            &doppler_sdk::ID,
        );

    // Update oracle with new values
    let oracle_update = Oracle::<PriceFeed> {
        sequence: 1, // Increment sequence from 0 to 1
        payload: PriceFeed { price: 1_100_000 },
    };

    let price_feed_update_instruction: Instruction = UpdateInstruction {
        admin,
        oracle_pubkey: oracle,
        oracle: oracle_update,
    }
    .into();

    MolluskComputeUnitBencher::new(mollusk)
        .bench((
            "CreatePriceFeed",
            &create_price_feed_instruction,
            &[
                (admin, admin_account.clone()),
                (oracle, Account::default()),
                (system, system_account),
            ],
        ))
        .bench((
            "PriceFeedUpdate",
            &price_feed_update_instruction,
            &[(admin, admin_account), (oracle, oracle_account)],
        ))
        .must_pass(true)
        .out_dir("benches/")
        .execute();
}
