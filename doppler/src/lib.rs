#![cfg_attr(target_os = "solana", feature(asm_experimental_arch))]

#[cfg(not(feature = "std"))]
extern crate alloc;

mod admin;
mod oracle;
mod panic_handler;

/// Helper to read a value at offset and cast it
///
/// # Safety
/// - The caller must ensure that `ptr.add(offset)` is a valid pointer and properly aligned for type `T`.
/// - The memory at the computed address must be initialized and valid for reads of type `T`.
#[inline(always)]
const unsafe fn read<T>(ptr: *const u8, offset: usize) -> T
where
    T: core::marker::Copy,
{
    *(ptr.add(offset) as *const T)
}

/// Helper to write a value at offset
///
/// # Safety
/// - The caller must ensure that `ptr.add(offset)` is a valid pointer and properly aligned for type `T`.
/// - The memory at the computed address must be valid for writes of type `T`.
#[inline(always)]
unsafe fn write<T>(ptr: *mut u8, offset: usize, value: T)
where
    T: core::marker::Copy,
{
    *(ptr.add(offset) as *mut T) = value;
}

pub mod prelude {
    pub use crate::admin::{Admin, ADMIN};
    pub use crate::oracle::{Oracle, PriceFeed};
    #[cfg(not(feature = "std"))]
    pub use crate::nostd_panic_handler;
}
