#![allow(clippy::all, dead_code, unused_imports)]

use solana_pubkey::{pubkey, Pubkey};

pub use doppler_sdk::{Oracle, UpdateInstruction};

pub const BYTECODE: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/doppler.so"));
pub const ID: Pubkey = pubkey!("fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm");

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PriceFeedIntegrationPayload {
    pub price: u64,
}

pub mod custom {
    use super::*;

    pub const BYTECODE: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/custom/doppler.so"));
    pub const ID: Pubkey = super::ID;
    pub const PAYLOAD_SIZE: usize = 48;

    pub use super::{Oracle, UpdateInstruction};

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

    pub const BYTECODE: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/sol_memcpy/doppler.so"));
    pub const ID: Pubkey = super::ID;
    pub const PAYLOAD_SIZE: usize = 47;

    pub use super::{Oracle, UpdateInstruction};

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
