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
        pub fn panic_handler(info: &core::panic::PanicInfo<'_>) -> ! {
            if let Some(location) = info.location() {
                unsafe {
                    $crate::panic_handler::sol_panic_(
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
