use doppler::prelude::*;
use doppler_program::PriceFeed;
use doppler_sdk::{Oracle, UpdateInstruction};
use mollusk_svm::result::Check;
use mollusk_svm::{program::keyed_account_for_system_program, Mollusk};
use solana_account::{Account, ReadableAccount};
use solana_clock::Epoch;
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;

// fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm
const PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0x09, 0xe2, 0x60, 0x40, 0xff, 0x10, 0xec, 0xcf, 0xc1, 0x6a, 0xf6, 0x16, 0x9a, 0x68, 0x04, 0x78,
    0x15, 0x14, 0x33, 0x02, 0xac, 0x6e, 0x98, 0x5f, 0x70, 0x85, 0x53, 0xe1, 0x0a, 0xb6, 0xf9, 0x22,
]);

#[must_use]
pub fn keyed_account_for_admin(key: Pubkey) -> (Pubkey, Account) {
    (
        key,
        Account::new(10_000_000_000, 0, &solana_sdk_ids::system_program::ID),
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

    let key = Pubkey::create_with_seed(&admin, seed, &PROGRAM_ID).unwrap();

    let lamports = mollusk
        .sysvars
        .rent
        .minimum_balance(core::mem::size_of::<Oracle<T>>());

    let data = oracle_account.to_bytes();

    let account = Account {
        lamports,
        data,
        owner: PROGRAM_ID,
        executable: false,
        rent_epoch: Epoch::default(),
    };

    (key, account)
}

#[test]
fn test_oracle_update() {
    // Create Mollusk instance
    let mut mollusk = Mollusk::new(&PROGRAM_ID, "../target/deploy/doppler_program");
    // Accounts
    let (admin, admin_account) = keyed_account_for_admin(ADMIN.into());
    let (oracle, oracle_account) = keyed_account_for_oracle::<PriceFeed>(
        &mut mollusk,
        ADMIN.into(),
        "SOL/USDC",
        PriceFeed { price: 100_000 },
    );
    let (system, system_account) = keyed_account_for_system_program();

    // Create oracle account
    let create_price_feed_instruction =
        solana_system_interface::instruction::create_account_with_seed(
            &admin,
            &oracle,
            &admin,
            "SOL/USDC",
            oracle_account.lamports,
            oracle_account.data.len() as u64,
            &PROGRAM_ID,
        );

    // Update oracle with new values
    let oracle_update = Oracle::<PriceFeed> {
        sequence: 1, // Increment sequence from 0 to 1
        payload: PriceFeed { price: 1_100_000 },
    };

    let price_feed_update_instruction: Instruction = UpdateInstruction {
        program_id: PROGRAM_ID,
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
            (admin, admin_account),
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
