/// Helper to read a value at offset and cast it
#[inline(always)]
pub unsafe fn read<T>(ptr: *const u8, offset: usize) -> T
where
    T: core::marker::Copy,
{
    *(ptr.add(offset) as *const T)
}

/// Helper to write a value at offset
#[inline(always)]
pub unsafe fn write<T>(ptr: *mut u8, offset: usize, value: T)
where
    T: core::marker::Copy,
{
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
