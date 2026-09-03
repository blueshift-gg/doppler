//! Doppler feeds: `HEADER` bytes of `last_updated_ms` (little-endian u64), then a packed payload.

#![no_std]

#[cfg(feature = "std")]
extern crate std;

#[cfg(feature = "std")]
mod elf;
#[cfg(feature = "std")]
mod schema;

pub use bytemuck::{self, Pod, Zeroable};
#[cfg(feature = "std")]
pub use elf::generate;
#[cfg(feature = "std")]
pub use schema::{feed_address, layout, update_data, Field, Layout, Manifest, Ty};

pub const HEADER: usize = 8;
pub const FEED_SEED: &str = "feed";
/// Loader-v3 programdata: tag, slot, optional authority.
pub const PROGRAMDATA_HEADER: usize = 4 + 8 + 1 + 32;

const MEMCPY_THRESHOLD: usize = 7;

const fn chunks(n: usize) -> usize {
    (n >> 3) + (n & 7).count_ones() as usize
}

/// One unit per instruction; `sol_memcpy_` costs `max(10, n / 250)` (agave mem_ops.rs). Pinned by tests/sweep.rs.
pub const fn update_cu(payload_size: usize) -> u32 {
    let chunks = chunks(payload_size);
    if chunks < MEMCPY_THRESHOLD {
        19 + 2 * chunks as u32
    } else {
        let per_byte = (HEADER + payload_size) as u32 / 250;
        21 + if per_byte > 10 { per_byte } else { 10 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    Schema(&'static str),
    WrongOwner,
    WrongSize,
    Stale,
}

impl core::fmt::Display for Error {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(match self {
            Error::Schema(why) => why,
            Error::WrongOwner => "the account is not owned by the feed program",
            Error::WrongSize => "the account size does not match the payload",
            Error::Stale => "the feed is older than allowed",
        })
    }
}

#[cfg(feature = "std")]
impl std::error::Error for Error {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Feed<'a> {
    pub last_updated_ms: u64,
    pub payload: &'a [u8],
}

impl Feed<'_> {
    /// Panics if `size_of::<T>()` is not the payload size.
    pub fn value<T: Pod>(&self) -> T {
        bytemuck::pod_read_unaligned(self.payload)
    }

    pub const fn age_ms(&self, now_ms: u64) -> u64 {
        now_ms.saturating_sub(self.last_updated_ms)
    }
}

pub fn read<'a>(
    data: &'a [u8],
    owner: &[u8; 32],
    program: &[u8; 32],
    payload_size: usize,
) -> Result<Feed<'a>, Error> {
    if owner != program {
        return Err(Error::WrongOwner);
    }
    match data.split_first_chunk::<HEADER>() {
        Some((ts, payload)) if payload.len() == payload_size => Ok(Feed {
            last_updated_ms: u64::from_le_bytes(*ts),
            payload,
        }),
        _ => Err(Error::WrongSize),
    }
}

/// Pyth's price feed fields, minus publish time.
#[repr(C, packed)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Pod, Zeroable)]
pub struct Price {
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
}

impl Price {
    pub const SIZE: usize = core::mem::size_of::<Self>();
}

pub fn price_no_older_than(feed: &Feed, now_ms: u64, max_age_ms: u64) -> Result<Price, Error> {
    if feed.payload.len() != Price::SIZE {
        return Err(Error::WrongSize);
    }
    if feed.age_ms(now_ms) > max_age_ms {
        return Err(Error::Stale);
    }
    Ok(feed.value())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROGRAM: [u8; 32] = [7; 32];

    #[test]
    fn read_checks_owner_then_size() {
        let data = [0u8; HEADER + 8];
        assert_eq!(read(&data, &[8; 32], &PROGRAM, 8), Err(Error::WrongOwner));
        assert_eq!(read(&data, &PROGRAM, &PROGRAM, 9), Err(Error::WrongSize));
        assert_eq!(
            read(&data[..7], &PROGRAM, &PROGRAM, 8),
            Err(Error::WrongSize)
        );
        assert_eq!(
            read(&data, &PROGRAM, &PROGRAM, 8).unwrap().value::<u64>(),
            0
        );
    }

    #[test]
    fn price_is_packed_and_expires() {
        assert_eq!(Price::SIZE, 20);
        let price = Price {
            price: -1,
            conf: 2,
            expo: -8,
        };
        let mut data = 1_000u64.to_le_bytes().to_vec();
        data.extend_from_slice(bytemuck::bytes_of(&price));
        let feed = read(&data, &PROGRAM, &PROGRAM, Price::SIZE).unwrap();
        assert_eq!(price_no_older_than(&feed, 1_100, 100), Ok(price));
        assert_eq!(price_no_older_than(&feed, 1_101, 100), Err(Error::Stale));
        assert_eq!(price_no_older_than(&feed, 0, 0), Ok(price));
    }
}
