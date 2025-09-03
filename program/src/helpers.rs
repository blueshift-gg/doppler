/// Helper to read a value at offset with bounds checking
/// 
/// # Safety
/// 
/// Caller must ensure:
/// - `ptr` is valid and points to allocated memory
/// - `total_size` represents the total allocated memory size
/// 
/// This function will safely exit the program if bounds are exceeded
#[inline(always)]
pub unsafe fn read<T>(ptr: *const u8, offset: usize, total_size: usize) -> T
where
    T: core::marker::Copy,
{
    let type_size = core::mem::size_of::<T>();
    
    // Bounds checking: ensure we don't read beyond allocated memory
    if offset + type_size > total_size {
        #[cfg(target_os = "solana")]
        unsafe {
            core::arch::asm!("lddw r0, 3\nexit"); // Exit code 3: Memory bounds exceeded
        }
        #[cfg(not(target_os = "solana"))]
        {
            core::arch::asm!("ud2", options(noreturn)); // Panic in non-Solana environments
        }
    }
    
    // Safe to read: bounds have been validated
    *(ptr.add(offset) as *const T)
}

/// Helper to write a value at offset with bounds checking
/// 
/// # Safety
/// 
/// Caller must ensure:
/// - `ptr` is valid and points to allocated memory
/// - `total_size` represents the total allocated memory size
/// - Memory at `offset` is writable
/// 
/// This function will safely exit the program if bounds are exceeded
#[inline(always)]
pub unsafe fn write<T>(ptr: *mut u8, offset: usize, value: T, total_size: usize)
where
    T: core::marker::Copy,
{
    let type_size = core::mem::size_of::<T>();
    
    // Bounds checking: ensure we don't write beyond allocated memory
    if offset + type_size > total_size {
        #[cfg(target_os = "solana")]
        unsafe {
            core::arch::asm!("lddw r0, 4\nexit"); // Exit code 4: Memory bounds exceeded on write
        }
        #[cfg(not(target_os = "solana"))]
        {
            core::arch::asm!("ud2", options(noreturn)); // Panic in non-Solana environments
        }
    }
    
    // Safe to write: bounds have been validated
    *(ptr.add(offset) as *mut T) = value;
}

#[allow(dead_code)]
extern "C" {
    pub fn sol_panic_(filename: *const u8, filename_len: u64, line: u64, column: u64) -> !;
}

#[macro_export]
macro_rules! nostd_panic_handler {
    () => {
        /// A panic handler for `no_std`.
        #[cfg(target_os = "solana")]
        #[no_mangle]
        #[panic_handler]
        fn panic_handler(info: &core::panic::PanicInfo<'_>) -> ! {
            if let Some(location) = info.location() {
                unsafe {
                    $crate::helpers::sol_panic_(
                        location.file().as_ptr(),
                        location.file().len() as u64,
                        location.line() as u64,
                        location.column() as u64,
                    )
                }
            } else {
                // If no location info, just abort
                unsafe { core::arch::asm!("abort", options(noreturn)) }
            }
        }

        #[cfg(not(target_os = "solana"))]
        mod __private_panic_handler {
            extern crate std as __std;
        }
    };
}
