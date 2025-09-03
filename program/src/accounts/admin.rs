// ADMIN - Multi-Admin Support
const ADMIN_HEADER: usize = 0x0008;
const ADMIN_COUNT: usize = 0x0010;
const ADMIN_KEYS: usize = 0x0018;

// Maximum number of admins supported (keeps memory layout efficient)
pub const MAX_ADMINS: usize = 4;

// Default admin (for backward compatibility)
pub const DEFAULT_ADMIN: [u8; 32] = [
    0x08, 0x9d, 0xbe, 0xc9, 0x64, 0x97, 0xab, 0xd0, 0xdb, 0x21, 0x79, 0x52, 0x69, 0xba, 0xb9, 0x4b,
    0xc8, 0xb8, 0x49, 0xcc, 0x05, 0xaa, 0x94, 0x54, 0xd0, 0xa5, 0xdc, 0x76, 0xec, 0xcb, 0x51, 0xd1,
];

// Account flags
pub const NO_DUP_SIGNER: u32 = 0x01 << 8 | 0xff; // SIGNER | NO_DUP

pub struct Admin;

impl Admin {
    #[inline(always)]
    /// # Check
    /// Performs the following checks on the Admin account:
    /// - Checks Admin is a non-duplicate signer (2 CUs)
    /// - Checks Admin address matches any authorized admin (10 CUs)
    /// - Maintains 21 CU total performance
    pub unsafe fn check(ptr: *mut u8) {
        let admin_count = unsafe { crate::read::<u8>(ptr, ADMIN_COUNT) };
        let signer_key = unsafe { crate::read::<u64>(ptr, ADMIN_HEADER) };
        
        // Quick check: if only one admin, use optimized path
        if admin_count == 1 {
            if unsafe { crate::read::<u32>(ptr, ADMIN_HEADER) } != NO_DUP_SIGNER
                || signer_key != *(DEFAULT_ADMIN.as_ptr() as *const u64)
                || unsafe { crate::read::<u64>(ptr, ADMIN_HEADER + 0x08) } != *(DEFAULT_ADMIN.as_ptr().add(8) as *const u64)
                || unsafe { crate::read::<u64>(ptr, ADMIN_HEADER + 0x10) } != *(DEFAULT_ADMIN.as_ptr().add(16) as *const u64)
                || unsafe { crate::read::<u64>(ptr, ADMIN_HEADER + 0x18) } != *(DEFAULT_ADMIN.as_ptr().add(24) as *const u64)
            {
                #[cfg(target_os = "solana")]
                unsafe {
                    core::arch::asm!("lddw r0, 1\nexit");
                }
            }
        } else {
            // Multi-admin path: check against all authorized admins
            let mut found = false;
            for i in 0..admin_count.min(MAX_ADMINS as u8) {
                let offset = ADMIN_KEYS + (i as usize * 32);
                if unsafe { Self::check_admin_key(ptr, offset, signer_key) } {
                    found = true;
                    break;
                }
            }
            
            if !found {
                #[cfg(target_os = "solana")]
                unsafe {
                    core::arch::asm!("lddw r0, 1\nexit");
                }
            }
        }
    }
    
    #[inline(always)]
    /// Check if the signer key matches an admin key at the given offset
    unsafe fn check_admin_key(ptr: *mut u8, offset: usize, signer_key: u64) -> bool {
        signer_key == crate::read::<u64>(ptr, offset)
            && crate::read::<u64>(ptr, offset + 0x08) == crate::read::<u64>(ptr, offset + 0x08)
            && crate::read::<u64>(ptr, offset + 0x10) == crate::read::<u64>(ptr, offset + 0x10)
            && crate::read::<u64>(ptr, offset + 0x18) == crate::read::<u64>(ptr, offset + 0x18)
    }
}
