use std::path::PathBuf;

use doppler_cli::{create_doppler_artifacts, load_generator_config, ConfigOverrides};
use mollusk_svm::Mollusk;
use solana_account::Account;
use solana_clock::Epoch;
use solana_pubkey::{pubkey, Pubkey};
use solana_sdk_ids::system_program;

pub use doppler_sdk::{Oracle, UpdateInstruction};

pub const ID: Pubkey = pubkey!("fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm");
pub const ADMIN: Pubkey = pubkey!("admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE");

pub fn fixture_bytecode(schema_file: &str) -> Vec<u8> {
    let schema = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(schema_file);
    let config =
        load_generator_config(&schema, ConfigOverrides::default()).expect("load schema fixture");
    create_doppler_artifacts(&config)
        .expect("generate artifacts from schema fixture")
        .binary
}

pub fn keyed_account_for_admin(key: Pubkey) -> (Pubkey, Account) {
    (key, Account::new(10_000_000_000, 0, &system_program::ID))
}

pub fn keyed_account_for_oracle<T: Sized + Copy>(
    mollusk: &Mollusk,
    admin: Pubkey,
    seed: &str,
    payload: T,
) -> (Pubkey, Account) {
    let oracle_account = Oracle {
        sequence: 0,
        payload,
    };

    let key = Pubkey::create_with_seed(&admin, seed, &ID).expect("oracle PDA");

    let account_size = Oracle::<T>::size();
    let lamports = mollusk.sysvars.rent.minimum_balance(account_size);

    let account = Account {
        lamports,
        data: oracle_account.to_bytes(),
        owner: ID,
        executable: false,
        rent_epoch: Epoch::default(),
    };

    (key, account)
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PriceFeedIntegrationPayload {
    pub price: u64,
}

pub mod custom {
    use super::*;

    pub const PAYLOAD_SIZE: usize = 48;

    pub fn bytecode() -> Vec<u8> {
        fixture_bytecode("custom_payload_schema.json")
    }

    #[repr(C)]
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct CustomOraclePayload {
        pub bid: u64,
        pub ask: u64,
        pub mid: u64,
        pub leg_a: u32,
        pub leg_b: u32,
        pub leg_c: u32,
        pub leg_d: u32,
        pub leg_e: u32,
        pub leg_f: u32,
    }
}

pub mod sol_memcpy {
    use super::*;

    pub const PAYLOAD_SIZE: usize = 47;

    pub fn bytecode() -> Vec<u8> {
        fixture_bytecode("sol_memcpy_payload_schema.json")
    }

    #[repr(C, packed)]
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct SolMemcpyOraclePayload {
        pub head: u64,
        pub a: u64,
        pub b: u64,
        pub c: u64,
        pub d: u64,
        pub tag: u32,
        pub seq_lo: u16,
        pub flags: u8,
    }
}
