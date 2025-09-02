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

#[no_mangle]
/// # Safety
///
/// This is a permissioned entrypoint only invokable by the
/// ADMIN keypair. It is as safe as you choose it to be.
pub unsafe extern "C" fn entrypoint(input: *mut u8) {
    Admin::check(input);
    Oracle::<PriceFeed>::check_and_update(input);
}
