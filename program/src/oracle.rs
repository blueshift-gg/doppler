// Account data offsets
const ORACLE_SEQUENCE: usize = 0x28c0; // (sequence: u64)
const ORACLE_PAYLOAD: usize = 0x28c8; // (payload: T)

#[repr(C)]
pub struct Oracle<T: Sized + Copy> {
    sequence: u64, // timestamp_millis, timestamp_seconds, autoincrement, whatever
    payload: T,
}

impl<T: Sized + Copy> Oracle<T> {
    // Relative offsets for instruction data
    const INSTRUCTION_SEQUENCE: usize = 0x50d8 + core::mem::size_of::<T>(); // (sequence: u64)
    const INSTRUCTION_PAYLOAD: usize = 0x50e0 + core::mem::size_of::<T>(); // (payload: T)

    /// # Safety
    ///
    /// The caller must ensure that `ptr` is a valid pointer to a memory region
    /// that is properly aligned and large enough to hold the data being read or written.
    /// Additionally, the memory region must not be accessed concurrently by other threads.
    #[inline(always)]
    pub unsafe fn check_and_update(ptr: *mut u8) {
        // Check timestamp validity
        let current_sequence = crate::read::<u64>(ptr, ORACLE_SEQUENCE);
        let new_sequence = crate::read::<u64>(ptr, Self::INSTRUCTION_SEQUENCE);

        if new_sequence <= current_sequence {
            #[cfg(target_os = "solana")]
            unsafe {
                core::arch::asm!("lddw r0, 2\nexit");
            }
        }

        // Update oracle data
        let new_payload = crate::read::<T>(ptr, Self::INSTRUCTION_PAYLOAD);
        crate::write(ptr, ORACLE_SEQUENCE, new_sequence);
        crate::write(ptr, ORACLE_PAYLOAD, new_payload);
    }
}
