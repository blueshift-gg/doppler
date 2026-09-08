#![no_std]
#![cfg_attr(target_os = "solana", feature(asm_experimental_arch))]

mod admin;
mod oracle;
pub mod panic_handler;

use admin::Admin;
pub use admin::ADMIN;
use oracle::Oracle;

// fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm
pub const ID: [u8; 32] = [
    0x09, 0xe2, 0x60, 0x40, 0xff, 0x10, 0xec, 0xcf, 0xc1, 0x6a, 0xf6, 0x16, 0x9a, 0x68, 0x04, 0x78,
    0x15, 0x14, 0x33, 0x02, 0xac, 0x6e, 0x98, 0x5f, 0x70, 0x85, 0x53, 0xe1, 0x0a, 0xb6, 0xf9, 0x22,
];

#[repr(C)]
#[derive(Clone, Copy)]
pub struct PriceFeed {
    pub price: u64,
}

nostd_panic_handler!();

#[no_mangle]
/// # Safety
///
/// This is a permissioned entrypoint only invokable by the
/// ADMIN keypair. It is as safe as you choose it to be.
pub unsafe extern "C" fn entrypoint(input: *mut u8) {
    Admin::check(input);
    Oracle::<PriceFeed>::check_and_update(input);
}

/// Helper to read a value at offset and cast it
///
/// # Safety
/// - The caller must ensure that `ptr.add(offset)` is a valid pointer and properly aligned for type `T`.
/// - The memory at the computed address must be initialized and valid for reads of type `T`.
#[inline(always)]
const unsafe fn read<T>(ptr: *const u8, offset: usize) -> T
where
    T: core::marker::Copy,
{
    *ptr.add(offset).cast::<T>()
}

/// Helper to write a value at offset
///
/// # Safety
/// - The caller must ensure that `ptr.add(offset)` is a valid pointer and properly aligned for type `T`.
/// - The memory at the computed address must be valid for writes of type `T`.
#[inline(always)]
unsafe fn write<T>(ptr: *mut u8, offset: usize, value: T)
where
    T: core::marker::Copy,
{
    *ptr.add(offset).cast::<T>() = value;
}
