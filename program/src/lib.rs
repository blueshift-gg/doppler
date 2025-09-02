#![no_std]
#![cfg_attr(target_os = "solana", feature(asm_experimental_arch))]

// fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm
mod accounts;
pub use accounts::ADMIN;
use accounts::*;
mod helpers;
use helpers::*;

nostd_panic_handler!();

#[repr(C)]
#[derive(Clone, Copy)]
pub struct PriceFeed {
    pub price: u64,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct PropAMM {
    pub bid: u64,
    pub ask: u64,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct MarketData {
    pub price: u64,
    pub volume: u64,
    pub confidence: u32,
}

#[no_mangle]
/// # Safety
///
/// This is a permissioned entrypoint only invokable by the
/// ADMIN keypair. It is as safe as you choose it to be.
pub unsafe extern "C" fn entrypoint(input: *mut u8) {
    Admin::check(input);
    Oracle::<PriceFeed>::check_and_update(input);
}
