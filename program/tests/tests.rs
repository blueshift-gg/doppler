//! Needs `cargo build-sbf --manifest-path program/Cargo.toml`.

use doppler_program::{ADMIN, ID};
use doppler_sdk::{
    doppler::{read, Field, Manifest, Ty, FEED_SEED},
    Doppler,
};
use mollusk_svm::{program::keyed_account_for_system_program, result::ProgramResult, Mollusk};
use solana_account::Account;
use solana_pubkey::Pubkey;
use solana_rent::Rent;
use solana_sdk_ids::system_program;
use solana_system_interface::instruction::create_account_with_seed;

pub fn doppler() -> Doppler<u64> {
    Doppler::from_manifest(Manifest {
        program: ID,
        admin: ADMIN,
        fields: vec![Field {
            name: "price".into(),
            ty: Ty::U64,
            len: 1,
        }],
    })
    .unwrap()
}

#[test]
fn create_then_update() {
    let mollusk = Mollusk::new(&Pubkey::from(ID), "../target/deploy/doppler_program");
    let d = doppler();
    let admin = Pubkey::from(ADMIN);
    let feed = d.address();
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

    let result = mollusk.process_instruction_chain(
        &[create, d.update(&1_100_000u64).instruction()],
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
