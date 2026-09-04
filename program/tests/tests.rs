//! Needs `cargo build-sbf --manifest-path program/Cargo.toml`.

use doppler::{feed_address, read, update_data, FEED_SEED};
use doppler_program::{ADMIN, ID};
use mollusk_svm::{program::keyed_account_for_system_program, result::ProgramResult, Mollusk};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;
use solana_rent::Rent;
use solana_sdk_ids::system_program;
use solana_system_interface::instruction::create_account_with_seed;

#[test]
fn create_then_update() {
    let mollusk = Mollusk::new(&Pubkey::from(ID), "../target/deploy/doppler_program");
    let admin = Pubkey::from(ADMIN);
    let feed = Pubkey::from(feed_address(&ADMIN, &ID));
    let (system, system_account) = keyed_account_for_system_program();
    let create = create_account_with_seed(
        &admin,
        &feed,
        &admin,
        FEED_SEED,
        Rent::default().minimum_balance(16),
        16,
        &Pubkey::from(ID),
    );
    let update = Instruction {
        program_id: Pubkey::from(ID),
        accounts: vec![
            AccountMeta::new_readonly(admin, true),
            AccountMeta::new(feed, false),
        ],
        data: update_data(1, &1_100_000u64.to_le_bytes()),
    };

    let result = mollusk.process_instruction_chain(
        &[create, update],
        &[
            (
                admin,
                Account::new(10_000_000_000, 0, &system_program::id()),
            ),
            (feed, Account::default()),
            (system, system_account),
        ],
    );
    assert!(
        matches!(result.program_result, ProgramResult::Success),
        "{:?}",
        result.program_result
    );

    let account = result.get_account(&feed).unwrap();
    let feed = read(&account.data, account.owner.as_array(), &ID, 8).unwrap();
    assert!(feed.sequence > 0);
    assert_eq!(feed.value::<u64>(), 1_100_000);
}
