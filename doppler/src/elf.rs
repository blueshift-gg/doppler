//! The programs as sBPF v3 ELFs: the listings as assembled, with the admin key, the copy and the
//! sizes patched in. tests/templates.rs keeps the checked-in programs equal to the listings.

use std::vec::Vec;

use crate::{padded, HEADER, MEMCPY_THRESHOLD};

/// One variant of the program: the listing with one copy pair, and the listing with `sol_memcpy_`.
struct Template {
    inline: &'static [u8],
    memcpy: &'static [u8],
    /// The file offset of slot 0.
    code: usize,
    /// The program header of the code, whose `p_filesz` and `p_memsz` grow with the pairs.
    load: usize,
}

/// doppler.s: 26 slots after the ELF header, one `PT_LOAD`.
const PUSH: Template = Template {
    inline: include_bytes!("../doppler.so"),
    memcpy: include_bytes!("../doppler-memcpy.so"),
    code: 0x78,
    load: 0x40,
};
/// program-extended: `.rodata` mapped at 0, then the listing followed by `pull` mapped at 2^32.
const PULL: Template = Template {
    inline: include_bytes!("../doppler-pull.so"),
    memcpy: include_bytes!("../doppler-pull-memcpy.so"),
    code: 0x140,
    load: 0x40 + 56,
};
/// The `lddw` slots holding the admin key: the low word at slot + 4, the high word at slot + 12.
const ADMIN_SLOTS: [usize; 4] = [3, 7, 11, 15];
/// `jne r3, 0x1ff, detached`: the offset grows with the pairs.
const DETACHED_SLOT: usize = 1;
/// Inline: `ldxdw r4, [r2+8]` and `stxdw [r1+0x28c8], r4`, then `exit`.
const PAIR_SLOT: usize = 23;
/// Memcpy: `mov64 r3, len`.
const LEN_SLOT: usize = 23;
const FEED_DATA: usize = 0x28c0;
/// `.rodata` of program-extended: the admin, then the program id.
const PULL_ADMIN: usize = 0xf0;
const PULL_ID: usize = 0x110;

pub fn generate(admin: &[u8; 32], payload_size: usize) -> Vec<u8> {
    build(&PUSH, admin, payload_size)
}

/// The pull program: `generate` with the admin's detached path, bound to the program id.
pub fn generate_pull(admin: &[u8; 32], program: &[u8; 32], payload_size: usize) -> Vec<u8> {
    let mut p = build(&PULL, admin, payload_size);
    let chunks = padded(payload_size) / 8;
    if chunks < MEMCPY_THRESHOLD {
        let at = PULL.code + 8 * DETACHED_SLOT + 2;
        let offset = i16::from_le_bytes([p[at], p[at + 1]]) + 2 * (chunks as i16 - 1);
        p[at..at + 2].copy_from_slice(&offset.to_le_bytes());
    }
    p[PULL_ADMIN..PULL_ADMIN + 32].copy_from_slice(admin);
    p[PULL_ID..PULL_ID + 32].copy_from_slice(program);
    p
}

fn build(t: &Template, admin: &[u8; 32], payload_size: usize) -> Vec<u8> {
    assert!(payload_size > 0, "a payload needs at least one byte");
    let size = padded(payload_size);
    let chunks = size / 8;
    let slot = |i: usize| t.code + 8 * i;
    let mut p = if chunks < MEMCPY_THRESHOLD {
        let mut p = t.inline[..slot(PAIR_SLOT)].to_vec();
        for i in 0..chunks {
            let mut pair: [u8; 16] = t.inline[slot(PAIR_SLOT)..slot(PAIR_SLOT + 2)]
                .try_into()
                .unwrap();
            pair[2..4].copy_from_slice(&((HEADER + 8 * i) as i16).to_le_bytes());
            pair[10..12].copy_from_slice(&((FEED_DATA + HEADER + 8 * i) as i16).to_le_bytes());
            p.extend_from_slice(&pair);
        }
        p.extend_from_slice(&t.inline[slot(PAIR_SLOT + 2)..]);
        let len = ((p.len() - t.code) as u64).to_le_bytes();
        p[t.load + 0x20..t.load + 0x28].copy_from_slice(&len);
        p[t.load + 0x28..t.load + 0x30].copy_from_slice(&len);
        p
    } else {
        let mut p = t.memcpy.to_vec();
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
    /// `call` with a static syscall: murmur3_32("sol_memcpy_").
    const SOL_MEMCPY: [u8; 8] = [0x85, 0, 0, 0, 0xa3, 0xc4, 0x7c, 0x71];

    fn filesz(p: &[u8], t: &Template) -> u64 {
        u64::from_le_bytes(p[t.load + 0x20..t.load + 0x28].try_into().unwrap())
    }

    #[test]
    fn default_program_is_26_slots_in_328_bytes() {
        let p = generate(&ADMIN, 8);
        assert_eq!(p.len(), 328);
        assert_eq!(p[0x30], 3);
        assert_eq!(filesz(&p, &PUSH), 328 - 0x78);
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
        assert_eq!(filesz(&p, &PUSH), 328 + 32 - 0x78);
        let pair =
            |i: usize| &p[0x78 + 8 * (PAIR_SLOT + 2 * i)..0x78 + 8 * (PAIR_SLOT + 2 * i) + 16];
        assert_eq!(&pair(0)[..4], [0x79, 0x24, 0x08, 0]);
        assert_eq!(&pair(2)[..4], [0x79, 0x24, 0x18, 0]);
        assert_eq!(&pair(2)[8..12], [0x7b, 0x41, 0xd8, 0x28]);
    }

    #[test]
    fn large_payloads_use_memcpy() {
        let inline = generate(&ADMIN, 40);
        let memcpy = generate(&ADMIN, 48);
        assert!(memcpy.len() < inline.len());
        assert_eq!(memcpy.len(), 336);
        assert!(memcpy.windows(8).any(|w| w == SOL_MEMCPY));
        assert!(!inline.windows(8).any(|w| w == SOL_MEMCPY));
        assert_eq!(
            memcpy[0x78 + 8 * LEN_SLOT + 4..0x78 + 8 * LEN_SLOT + 8],
            [56, 0, 0, 0]
        );
        assert_eq!(generate(&ADMIN, 41), generate(&ADMIN, 48));
    }

    /// The pull templates are built with this admin and `[11; 32]` as the program id, so every
    /// place `generate_pull` patches holds them, and nothing else does.
    #[test]
    fn pull_templates_hold_the_placeholders_where_they_are_patched() {
        for (t, push) in [(PULL.inline, PUSH.inline), (PULL.memcpy, PUSH.memcpy)] {
            let positions = |needle: &[u8]| -> Vec<usize> {
                (0..t.len() - 31)
                    .filter(|&i| t[i..i + needle.len()] == *needle)
                    .collect()
            };
            assert_eq!(positions(&ADMIN), [PULL_ADMIN]);
            assert_eq!(positions(&[11; 32]), [PULL_ID]);
            let mut prefix = t[PULL.code..PULL.code + 8 * PAIR_SLOT].to_vec();
            prefix[8 * DETACHED_SLOT + 2] = push[0x78 + 8 * DETACHED_SLOT + 2];
            assert_eq!(
                prefix,
                push[0x78..0x78 + 8 * PAIR_SLOT],
                "the push path is the listing, up to where it jumps to detached"
            );
        }
    }

    #[test]
    fn pull_program_binds_the_admin_and_the_id() {
        let program = [3; 32];
        let admin = [7; 32];
        let jne = PULL.code + 8 * DETACHED_SLOT;
        let p = generate_pull(&admin, &program, 8);
        assert_eq!(p.len(), PULL.inline.len());
        assert_eq!(filesz(&p, &PULL), (PULL.inline.len() - PULL.code) as u64);
        assert_eq!(p[PULL_ADMIN..PULL_ADMIN + 32], admin);
        assert_eq!(p[PULL_ID..PULL_ID + 32], program);
        assert_eq!(p[jne..jne + 4], [0x55, 0x03, 0x18, 0]);
        let p = generate_pull(&admin, &program, 40);
        assert_eq!(p.len(), PULL.inline.len() + 4 * 16);
        assert_eq!(filesz(&p, &PULL), (p.len() - PULL.code) as u64);
        assert_eq!(p[jne..jne + 4], [0x55, 0x03, 0x18 + 8, 0]);
        let p = generate_pull(&admin, &program, 48);
        assert_eq!(p.len(), PULL.memcpy.len());
        assert_eq!(p[jne..jne + 4], [0x55, 0x03, 0x19, 0]);
        let len = PULL.code + 8 * LEN_SLOT + 4;
        assert_eq!(p[len..len + 4], [56, 0, 0, 0]);
    }
}
