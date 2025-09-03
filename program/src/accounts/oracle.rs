// ORACLE - Account data offsets with batch support
const ORACLE_SEQUENCE: usize = 0x28c0; // (sequence: u64)
const ORACLE_PAYLOAD: usize = 0x28c8; // (payload: T)
const ORACLE_BATCH_COUNT: usize = 0x28d0; // (batch_count: u8)

#[repr(C)]
pub struct Oracle<T: Sized + Copy> {
    sequence: u64, // timestamp_millis, timestamp_seconds, autoincrement, whatever
    payload: T,
}

impl<T: Sized + Copy> Oracle<T> {
    // Relative offsets for instruction data
    const INSTRUCTION_SEQUENCE: usize = 0x50e8 + core::mem::size_of::<T>(); // (sequence: u64)
    const INSTRUCTION_PAYLOAD: usize = 0x50f0 + core::mem::size_of::<T>(); // (payload: T)
    const INSTRUCTION_BATCH_COUNT: usize = 0x50f8 + core::mem::size_of::<T>(); // (batch_count: u8)

    #[inline(always)]
    pub unsafe fn check_and_update(ptr: *mut u8) {
        let batch_count = unsafe { crate::read::<u8>(ptr, Self::INSTRUCTION_BATCH_COUNT) };
        
        if batch_count == 1 {
            // Single update - use optimized path (same as original)
            unsafe { Self::single_update(ptr) };
        } else {
            // Batch update - process multiple updates
            unsafe { Self::batch_update(ptr, batch_count) };
        }
    }
    
    #[inline(always)]
    /// Single update - optimized for 21 CU performance
    unsafe fn single_update(ptr: *mut u8) {
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
    
    #[inline(always)]
    /// Batch update - process multiple updates efficiently
    unsafe fn batch_update(ptr: *mut u8, batch_count: u8) {
        let mut current_sequence = crate::read::<u64>(ptr, ORACLE_SEQUENCE);
        
        // Process each update in the batch
        for i in 0..batch_count.min(8) { // Limit to 8 updates for performance
            let offset = i as usize * (8 + core::mem::size_of::<T>());
            let new_sequence = crate::read::<u64>(ptr, Self::INSTRUCTION_SEQUENCE + offset);
            
            if new_sequence <= current_sequence {
                #[cfg(target_os = "solana")]
                unsafe {
                    core::arch::asm!("lddw r0, 2\nexit");
                }
            }
            
            let new_payload = crate::read::<T>(ptr, Self::INSTRUCTION_PAYLOAD + offset);
            current_sequence = new_sequence;
            
            // Update oracle data
            crate::write(ptr, ORACLE_SEQUENCE, new_sequence);
            crate::write(ptr, ORACLE_PAYLOAD, new_payload);
        }
        
        // Update batch count
        crate::write(ptr, ORACLE_BATCH_COUNT, batch_count);
    }
}
