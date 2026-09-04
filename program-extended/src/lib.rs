#![cfg_attr(target_os = "solana", no_std)]
#![cfg_attr(target_os = "solana", feature(asm_experimental_arch))]

mod ed25519;
#[cfg(target_os = "solana")]
mod oracle;

pub use ed25519::DOMAIN;

/// admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE, examples/keys/admin-keypair.json. Fixed in the
/// bytecode, as in every Doppler program; generated programs replace it.
pub const ADMIN: [u8; 32] = [
    0x08, 0x9d, 0xbe, 0xc9, 0x64, 0x97, 0xab, 0xd0, 0xdb, 0x21, 0x79, 0x52, 0x69, 0xba, 0xb9, 0x4b,
    0xc8, 0xb8, 0x49, 0xcc, 0x05, 0xaa, 0x94, 0x54, 0xd0, 0xa5, 0xdc, 0x76, 0xec, 0xcb, 0x51, 0xd1,
];

/// The program id, part of the pull message; generated programs replace it.
pub const ID: [u8; 32] = [11; 32];

#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct PriceFeed {
    pub price: u64,
}

#[cfg(target_os = "solana")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    unsafe { core::arch::asm!("lddw r0, 0x400000000\nexit", options(noreturn)) }
}

/// # Safety
///
/// `input` must be the Solana program input buffer for exactly the accounts and
/// instruction layouts accepted by `Oracle`.
#[cfg(target_os = "solana")]
#[no_mangle]
pub unsafe extern "C" fn entrypoint(input: *mut u8) {
    oracle::Oracle::<PriceFeed>::update(input);
}

#[cfg(target_os = "solana")]
#[inline(always)]
unsafe fn read<T: Copy>(ptr: *const u8, offset: usize) -> T {
    ptr.add(offset).cast::<T>().read_unaligned()
}

#[cfg(target_os = "solana")]
#[inline(always)]
unsafe fn write<T: Copy>(ptr: *mut u8, offset: usize, value: T) {
    ptr.add(offset).cast::<T>().write_unaligned(value);
}

/// Exit codes.
#[cfg(target_os = "solana")]
const WRONG_SIGNER: i32 = 1;
#[cfg(target_os = "solana")]
const STALE: i32 = 2;
#[cfg(target_os = "solana")]
const BAD_SIGNATURE: i32 = 3;

#[cfg(target_os = "solana")]
#[inline(always)]
fn fail(code: i32) -> ! {
    unsafe { core::arch::asm!("mov64 r0, {code}\nexit", code = in(reg) code, options(noreturn)) }
}
