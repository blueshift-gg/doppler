#![no_std]
#![cfg_attr(target_os = "solana", feature(asm_experimental_arch))]

// ADMIN
const ADMIN_HEADER: usize = 0x0008;
const ADMIN_KEY: usize = 0x0010;

// admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE
pub const ADMIN: [u8; 32] = [
    0x08, 0x9d, 0xbe, 0xc9, 0x64, 0x97, 0xab, 0xd0, 0xdb, 0x21, 0x79, 0x52, 0x69, 0xba, 0xb9, 0x4b,
    0xc8, 0xb8, 0x49, 0xcc, 0x05, 0xaa, 0x94, 0x54, 0xd0, 0xa5, 0xdc, 0x76, 0xec, 0xcb, 0x51, 0xd1,
];

// Account flags
pub const NO_DUP_SIGNER: u16 = 0x01 << 8 | 0xff; // SIGNER | NO_DUP

pub struct Admin;

impl Admin {
    #[inline(always)]
    /// # Check
    /// Performs the following checks on the Admin account:
    /// - Checks Admin is a non-duplicate signer (2 CUs)
    /// - Checks Admin address matches ADMIN (12 CUs)
    ///
    /// # Safety
    /// - The caller must ensure that `ptr` is a valid pointer to a memory region
    ///   that can be safely read from.
    /// - The memory region must be properly aligned and large enough to hold the
    ///   data being read.
    pub unsafe fn check(ptr: *mut u8) {
        if crate::read::<u16>(ptr, ADMIN_HEADER) != NO_DUP_SIGNER
            || crate::read::<u64>(ptr, ADMIN_KEY) != *(ADMIN.as_ptr() as *const u64)
            || crate::read::<u64>(ptr, ADMIN_KEY + 0x08) != *(ADMIN.as_ptr().add(8) as *const u64)
            || crate::read::<u64>(ptr, ADMIN_KEY + 0x10) != *(ADMIN.as_ptr().add(16) as *const u64)
            || crate::read::<u64>(ptr, ADMIN_KEY + 0x18) != *(ADMIN.as_ptr().add(24) as *const u64)
        {
            #[cfg(target_os = "solana")]
            unsafe {
                core::arch::asm!("lddw r0, 1\nexit");
            }
        }
    }
}

/// Helper to read a value at offset and cast it
#[inline(always)]
unsafe fn read<T>(ptr: *const u8, offset: usize) -> T
where
    T: core::marker::Copy,
{
    *(ptr.add(offset) as *const T)
}
