use doppler::PriceFeed;
use doppler_sdk::{Oracle, UpdateInstruction};
use mollusk_svm::result::Check;
use mollusk_svm::{program::keyed_account_for_system_program, Mollusk};
use solana_account::{Account, ReadableAccount};
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

#[test]
fn test_oracle_update() {
    // Create Mollusk instance
    let mut mollusk = Mollusk::new(&doppler_sdk::ID, "../target/deploy/doppler");
    // Accounts
    let (admin, admin_account) = keyed_account_for_admin(doppler_admin::ADMIN.into());
    let (oracle, oracle_account) = keyed_account_for_oracle::<PriceFeed>(
        &mut mollusk,
        doppler_admin::ADMIN.into(),
        "SOL/USDC",
        PriceFeed { price: 100_000 },
    );
    let (system, system_account) = keyed_account_for_system_program();

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

    // Execute instruction
    let result = mollusk.process_and_validate_instruction_chain(
        &[
            (&create_price_feed_instruction, &[Check::success()]),
            (&price_feed_update_instruction, &[Check::success()]),
        ],
        &vec![
            (admin, admin_account.clone()),
            (oracle, Account::default()),
            (system, system_account),
        ],
    );

    // Get updated oracle account
    let updated_oracle = result.get_account(&oracle).expect("Missing oracle account");

    let oracle = Oracle::<PriceFeed>::from_bytes(updated_oracle.data());
    // Verify the oracle was updated
    assert_eq!(&oracle.sequence, &1u64, "Sequence should be updated");
    assert_eq!(&oracle.payload.price, &1_100_000, "Price should be updated");
}
