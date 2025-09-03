// ORACLE - Solana account data layout offsets
// These offsets are based on Solana's account data structure and instruction format
// 0x28c0: Oracle sequence number offset (8 bytes for u64)
// 0x28c8: Oracle payload data offset (variable size based on T)
const ORACLE_SEQUENCE: usize = 0x28c0;
const ORACLE_PAYLOAD: usize = 0x28c8;

#[repr(C)]
pub struct Oracle<T: Sized + Copy> {
    sequence: u64, // timestamp_millis, timestamp_seconds, autoincrement, whatever
    payload: T,
}

impl<T: Sized + Copy> Oracle<T> {
    // Instruction data offsets - calculated dynamically based on payload size
    // Base offset 0x50e8: Instruction data start position
    // Base offset 0x50f0: Instruction payload start position
    // These are adjusted by payload size to ensure proper alignment
    // 
    // Memory Layout Strategy:
    // - Oracle account data: Fixed offsets for sequence (0x28c0) and payload (0x28c8)
    // - Instruction data: Dynamic offsets based on payload size to handle different T types
    // - This allows the same program to work with PriceFeed, PropAMM, MarketData, etc.
    const INSTRUCTION_SEQUENCE: usize = 0x50e8 + core::mem::size_of::<T>();
    const INSTRUCTION_PAYLOAD: usize = 0x50f0 + core::mem::size_of::<T>();

    #[inline(always)]
    pub unsafe fn check_and_update(ptr: *mut u8) {
        // Check timestamp validity - bounds checking is now handled by read() function
        let current_sequence = crate::read::<u64>(ptr, ORACLE_SEQUENCE, 0x10000);
        let new_sequence = crate::read::<u64>(ptr, Self::INSTRUCTION_SEQUENCE, 0x10000);

        if new_sequence <= current_sequence {
            #[cfg(target_os = "solana")]
            unsafe {
                core::arch::asm!("lddw r0, 2\nexit");
            }
        }

        // Update oracle data - bounds checking is now handled by read() and write() functions
        let new_payload = crate::read::<T>(ptr, Self::INSTRUCTION_PAYLOAD, 0x10000);
        crate::write(ptr, ORACLE_SEQUENCE, new_sequence, 0x10000);
        crate::write(ptr, ORACLE_PAYLOAD, new_payload, 0x10000);
    }
}
