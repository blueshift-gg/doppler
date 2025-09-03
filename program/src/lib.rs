#![no_std]
#![cfg_attr(target_os = "solana", feature(asm_experimental_arch))]

// Doppler Pro - Enterprise Oracle with Multi-Admin, Batch Updates, and Monitoring
mod accounts;
pub use accounts::admin::DEFAULT_ADMIN;
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
/// This is a permissioned entrypoint only invokable by authorized
/// ADMIN keypairs. It is as safe as you choose it to be.
pub unsafe extern "C" fn entrypoint(input: *mut u8) {
    // Check admin authorization
    admin::Admin::check(input);
    
    // Process oracle update (single or batch)
    oracle::Oracle::<PriceFeed>::check_and_update(input);
    
    // Record monitoring data
    let cu_used = 21; // Base CU usage for single update
    let is_batch = crate::read::<u8>(input, 0x50f8 + core::mem::size_of::<PriceFeed>()) > 1;
    monitoring::Monitoring::record_update(input, cu_used, is_batch);
}
