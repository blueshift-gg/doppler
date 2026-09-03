//! Needs `cargo build-sbf --manifest-path program/Cargo.toml`.

use doppler_program::{ADMIN, ID};
use doppler_sdk::{
    doppler::{Field, Manifest, Ty, FEED_SEED},
    Doppler,
};
use mollusk_svm::{program::keyed_account_for_system_program, Mollusk};
use mollusk_svm_bencher::MolluskComputeUnitBencher;
use solana_account::Account;
use solana_pubkey::Pubkey;
use solana_rent::Rent;
use solana_sdk_ids::system_program;
use solana_system_interface::instruction::create_account_with_seed;

fn main() {
    let mollusk = Mollusk::new(&Pubkey::from(ID), "../target/deploy/doppler_program");
    let d = Doppler::<u64>::from_manifest(Manifest {
        program: ID,
        admin: ADMIN,
        fields: vec![Field {
            name: "price".into(),
            ty: Ty::U64,
            len: 1,
        }],
    })
    .unwrap();
    let admin = Pubkey::from(ADMIN);
    let feed = d.address();
    let (system, system_account) = keyed_account_for_system_program();
    let admin_account = Account::new(10_000_000_000, 0, &system_program::id());
    let lamports = Rent::default().minimum_balance(16);
    let feed_account = Account {
        lamports,
        data: vec![0; 16],
        owner: Pubkey::from(ID),
        ..Account::default()
    };
    let create = create_account_with_seed(
        &admin,
        &feed,
        &admin,
        FEED_SEED,
        lamports,
        16,
        &Pubkey::from(ID),
    );

    MolluskComputeUnitBencher::new(mollusk)
        .bench((
            "CreatePriceFeed",
            &create,
            &[
                (admin, admin_account.clone()),
                (feed, Account::default()),
                (system, system_account),
            ],
        ))
        .bench((
            "PriceFeedUpdate",
            &d.update(&1_100_000u64).instruction(),
            &[(admin, admin_account), (feed, feed_account)],
        ))
        .must_pass(true)
        .out_dir("benches/")
        .execute();
}
