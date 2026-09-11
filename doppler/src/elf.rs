//! The program as an sBPF v3 ELF: doppler.s and doppler-memcpy.s as `sbpf` assembles them, with the
//! admin key, the copy and the sizes patched in. tests/templates.rs keeps doppler.so and
//! doppler-memcpy.so equal to the listings.

use std::vec::Vec;

use crate::{padded, HEADER, MEMCPY_THRESHOLD};

/// doppler.s: one copy pair, 26 slots.
const INLINE: &[u8] = include_bytes!("../doppler.so");
/// doppler-memcpy.s: 27 slots.
const MEMCPY: &[u8] = include_bytes!("../doppler-memcpy.so");
/// `p_offset`: the ELF header, then the slots.
const CODE: usize = 0x78;
const P_FILESZ: usize = 0x60;
const P_MEMSZ: usize = 0x68;
/// The `lddw` slots holding the admin key: the low word at slot + 4, the high word at slot + 12.
const ADMIN_SLOTS: [usize; 4] = [3, 7, 11, 15];
/// Inline: `ldxdw r4, [r2+8]` and `stxdw [r1+0x28c8], r4`, then `exit`.
const PAIR_SLOT: usize = 23;
/// Memcpy: `mov64 r3, len`.
const LEN_SLOT: usize = 23;
const FEED_DATA: usize = 0x28c0;

pub fn generate(admin: &[u8; 32], payload_size: usize) -> Vec<u8> {
    assert!(payload_size > 0, "a payload needs at least one byte");
    let size = padded(payload_size);
    let chunks = size / 8;
    let slot = |i: usize| CODE + 8 * i;
    let mut p = if chunks < MEMCPY_THRESHOLD {
        let mut p = INLINE[..slot(PAIR_SLOT)].to_vec();
        for i in 0..chunks {
            let mut pair: [u8; 16] = INLINE[slot(PAIR_SLOT)..slot(PAIR_SLOT + 2)]
                .try_into()
                .unwrap();
            pair[2..4].copy_from_slice(&((HEADER + 8 * i) as i16).to_le_bytes());
            pair[10..12].copy_from_slice(&((FEED_DATA + HEADER + 8 * i) as i16).to_le_bytes());
            p.extend_from_slice(&pair);
        }
        p.extend_from_slice(&INLINE[slot(PAIR_SLOT + 2)..]);
        let len = ((p.len() - CODE) as u32).to_le_bytes();
        p[P_FILESZ..P_FILESZ + 4].copy_from_slice(&len);
        p[P_MEMSZ..P_MEMSZ + 4].copy_from_slice(&len);
        p
    } else {
        let mut p = MEMCPY.to_vec();
        p[slot(LEN_SLOT) + 4..slot(LEN_SLOT) + 8]
            .copy_from_slice(&((HEADER + size) as i32).to_le_bytes());
        p
    };
    for (word, &at) in admin.as_chunks::<8>().0.iter().zip(&ADMIN_SLOTS) {
        p[slot(at) + 4..slot(at) + 8].copy_from_slice(&word[..4]);
        p[slot(at) + 12..slot(at) + 16].copy_from_slice(&word[4..]);
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    /// admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE
    const ADMIN: [u8; 32] = [
        0x08, 0x9d, 0xbe, 0xc9, 0x64, 0x97, 0xab, 0xd0, 0xdb, 0x21, 0x79, 0x52, 0x69, 0xba, 0xb9,
        0x4b, 0xc8, 0xb8, 0x49, 0xcc, 0x05, 0xaa, 0x94, 0x54, 0xd0, 0xa5, 0xdc, 0x76, 0xec, 0xcb,
        0x51, 0xd1,
    ];

    #[test]
    fn default_program_is_26_slots_in_328_bytes() {
        let p = generate(&ADMIN, 8);
        assert_eq!(p.len(), 328);
        assert_eq!(p[0x30], 3);
        assert_eq!(
            u32::from_le_bytes(p[P_FILESZ..P_FILESZ + 4].try_into().unwrap()),
            328 - 0x78
        );
        assert_eq!(
            p[0x78..0x88],
            [0x69, 0x13, 0x08, 0, 0, 0, 0, 0, 0x55, 0x03, 0x13, 0, 0xff, 0x01, 0, 0]
        );
        assert_eq!(
            p[0x90..0xa0],
            [0x18, 0x04, 0, 0, 0x08, 0x9d, 0xbe, 0xc9, 0, 0, 0, 0, 0x64, 0x97, 0xab, 0xd0]
        );
        assert_eq!(p[p.len() - 8..], [0x95, 0, 0, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn payloads_pad_to_a_chunk_and_the_pairs_advance() {
        assert_eq!(generate(&ADMIN, 20), generate(&ADMIN, 24));
        let p = generate(&ADMIN, 24);
        assert_eq!(p.len(), 328 + 32);
        assert_eq!(
            u32::from_le_bytes(p[P_MEMSZ..P_MEMSZ + 4].try_into().unwrap()),
            328 + 32 - 0x78
        );
        let pair =
            |i: usize| &p[CODE + 8 * (PAIR_SLOT + 2 * i)..CODE + 8 * (PAIR_SLOT + 2 * i) + 16];
        assert_eq!(&pair(0)[..4], [0x79, 0x24, 0x08, 0]);
        assert_eq!(&pair(2)[..4], [0x79, 0x24, 0x18, 0]);
        assert_eq!(&pair(2)[8..12], [0x7b, 0x41, 0xd8, 0x28]);
    }

    #[test]
    fn large_payloads_use_memcpy() {
        /// `call` with a static syscall: murmur3_32("sol_memcpy_").
        const SOL_MEMCPY: [u8; 8] = [0x85, 0, 0, 0, 0xa3, 0xc4, 0x7c, 0x71];
        let inline = generate(&ADMIN, 40);
        let memcpy = generate(&ADMIN, 48);
        assert!(memcpy.len() < inline.len());
        assert_eq!(memcpy.len(), 336);
        assert!(memcpy.windows(8).any(|w| w == SOL_MEMCPY));
        assert!(!inline.windows(8).any(|w| w == SOL_MEMCPY));
        assert_eq!(
            memcpy[CODE + 8 * LEN_SLOT + 4..CODE + 8 * LEN_SLOT + 8],
            [56, 0, 0, 0]
        );
        assert_eq!(generate(&ADMIN, 41), generate(&ADMIN, 48));
    }
}
