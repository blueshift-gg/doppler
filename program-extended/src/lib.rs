//! The Doppler program with a second write path: the push of doppler/doppler.s, in
//! src/doppler-pull.s, and for anyone carrying the admin's detached signature, `pull`, which
//! verifies it with brine-ed25519.

#![cfg_attr(target_os = "solana", no_std)]
#![cfg_attr(target_os = "solana", feature(asm_experimental_arch))]

#[cfg(target_os = "solana")]
mod oracle;

/// admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE, examples/keys/admin-keypair.json. Fixed in the
/// program, as in every Doppler program; `doppler::generate_pull` replaces it. A static read
/// volatile, so it is one block in `.rodata` rather than immediates.
pub static ADMIN: [u8; 32] = [
    0x08, 0x9d, 0xbe, 0xc9, 0x64, 0x97, 0xab, 0xd0, 0xdb, 0x21, 0x79, 0x52, 0x69, 0xba, 0xb9, 0x4b,
    0xc8, 0xb8, 0x49, 0xcc, 0x05, 0xaa, 0x94, 0x54, 0xd0, 0xa5, 0xdc, 0x76, 0xec, 0xcb, 0x51, 0xd1,
];

/// The program id, part of the pull message; `doppler::generate_pull` replaces it.
pub static ID: [u8; 32] = [11; 32];

#[cfg(all(target_os = "solana", not(feature = "memcpy")))]
core::arch::global_asm!(include_str!("doppler-pull.s"));
#[cfg(all(target_os = "solana", feature = "memcpy"))]
core::arch::global_asm!(include_str!("doppler-pull-memcpy.s"));

/// The listing jumps here, so there is no caller: returning is the program exiting with 0.
///
/// # Safety
///
/// `input` is the Solana program input buffer, and account 0 is the feed.
#[cfg(target_os = "solana")]
#[no_mangle]
pub unsafe extern "C" fn pull(input: *mut u8) -> u64 {
    oracle::pull(input);
    0
}

#[cfg(target_os = "solana")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    unsafe { solana_define_syscall::definitions::abort() }
}

#[cfg(target_os = "solana")]
#[inline(always)]
unsafe fn read<T: Copy>(ptr: *const u8, offset: usize) -> T {
    ptr.add(offset).cast::<T>().read_unaligned()
}

/// Exit codes; the listing's own failures exit with 1.
#[cfg(target_os = "solana")]
const WRONG_SIGNER: u64 = 1;
#[cfg(target_os = "solana")]
const STALE: u64 = 2;
#[cfg(target_os = "solana")]
const BAD_SIGNATURE: u64 = 3;

/// The listing jumped into `pull`, so this `exit` ends the program.
#[cfg(target_os = "solana")]
#[inline(always)]
fn fail(code: u64) -> ! {
    unsafe { core::arch::asm!("mov64 r0, {code}\nexit", code = in(reg) code, options(noreturn)) }
}
