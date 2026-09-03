//! The program as an sBPF v3 ELF. Listing: doppler.s.

use std::vec::Vec;

use crate::{chunks, HEADER, MEMCPY_THRESHOLD};

const LDXB: u8 = 0x71;
const LDXH: u8 = 0x69;
const LDXW: u8 = 0x61;
const LDXDW: u8 = 0x79;
const STXB: u8 = 0x73;
const STXH: u8 = 0x6b;
const STXW: u8 = 0x63;
const STXDW: u8 = 0x7b;
const LDDW: u8 = 0x18;
const ADD64_IMM: u8 = 0x07;
const MOV64_IMM: u8 = 0xb7;
const JNE_IMM: u8 = 0x55;
const JNE_REG: u8 = 0x5d;
const JLT_REG: u8 = 0xad;
const CALL: u8 = 0x85;
const EXIT: u8 = 0x95;

const ADMIN_FLAGS: i16 = 0x08;
const NOT_DUP_SIGNER: i32 = 0x01ff;
const ADMIN_KEY: i16 = 0x10;
const FEED_DATA: i16 = 0x28c0;
/// murmur3_32("sol_memcpy_")
const SOL_MEMCPY: i32 = 0x717c_c4a3_u32 as i32;

const ELF: [u8; 0x78] = [
    0x7f, b'E', b'L', b'F', 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, // ELF64 LE
    3, 0, 0xf7, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, // ET_DYN EM_BPF, e_entry 1<<32
    0x40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // e_phoff 0x40, e_shoff 0
    3, 0, 0, 0, 0x40, 0, 0x38, 0, 1, 0, 0x40, 0, 0, 0, 0, 0, // e_flags v3, 1 phdr, 0 shdr
    1, 0, 0, 0, 1, 0, 0, 0, 0x78, 0, 0, 0, 0, 0, 0, 0, // PT_LOAD PF_X, p_offset 0x78
    0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, // p_vaddr p_paddr 1<<32
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // p_filesz p_memsz: patched
    0, 0, 0, 0, 0, 0, 0, 0, // p_align 0
];
const P_FILESZ: usize = 0x60;
const P_MEMSZ: usize = 0x68;

const fn insn(op: u8, dst: u8, src: u8, off: i16, imm: i32) -> [u8; 8] {
    let [o0, o1] = off.to_le_bytes();
    let [i0, i1, i2, i3] = imm.to_le_bytes();
    [op, src << 4 | dst, o0, o1, i0, i1, i2, i3]
}

fn widths(n: usize) -> impl Iterator<Item = usize> {
    core::iter::repeat_n(8, n >> 3).chain([4, 2, 1].into_iter().filter(move |w| n & w != 0))
}

pub fn generate(admin: &[u8; 32], payload_size: usize) -> Vec<u8> {
    assert!(payload_size > 0, "a payload needs at least one byte");
    let size = HEADER + payload_size;
    let memcpy = chunks(payload_size) >= MEMCPY_THRESHOLD;
    let mut p = Vec::with_capacity(ELF.len() + 8 * (2 + 16 + 5 + 2 * MEMCPY_THRESHOLD));
    p.extend_from_slice(&ELF);

    p.extend(insn(LDXH, 3, 1, ADMIN_FLAGS, 0));
    p.extend(insn(JNE_IMM, 3, 0, 19, NOT_DUP_SIGNER));
    for (i, word) in admin.chunks_exact(8).enumerate() {
        let word = u64::from_le_bytes(word.try_into().unwrap());
        p.extend(insn(LDXDW, 3, 1, ADMIN_KEY + 8 * i as i16, 0));
        p.extend(insn(LDDW, 4, 0, 0, word as i32));
        p.extend(insn(0, 0, 0, 0, (word >> 32) as i32));
        p.extend(insn(JNE_REG, 3, 4, 15 - 4 * i as i16, 0));
    }

    p.extend(insn(LDXDW, 3, 1, FEED_DATA, 0));
    p.extend(insn(LDXDW, 4, 2, 0, 0));
    p.extend(insn(JLT_REG, 3, 4, if memcpy { 2 } else { 1 }, 0));
    p.extend(insn(MOV64_IMM, 0, 0, 0, 1));
    if memcpy {
        p.extend(insn(EXIT, 0, 0, 0, 0));
        p.extend(insn(MOV64_IMM, 3, 0, 0, size as i32));
        p.extend(insn(ADD64_IMM, 1, 0, 0, FEED_DATA as i32));
        p.extend(insn(CALL, 0, 0, 0, SOL_MEMCPY));
    } else {
        p.extend(insn(STXDW, 1, 4, FEED_DATA, 0));
        let mut at = HEADER;
        for width in widths(payload_size) {
            let (ldx, stx) = match width {
                8 => (LDXDW, STXDW),
                4 => (LDXW, STXW),
                2 => (LDXH, STXH),
                _ => (LDXB, STXB),
            };
            p.extend(insn(ldx, 4, 2, at as i16, 0));
            p.extend(insn(stx, 1, 4, FEED_DATA + at as i16, 0));
            at += width;
        }
    }
    p.extend(insn(EXIT, 0, 0, 0, 0));

    let code = ((p.len() - ELF.len()) as u32).to_le_bytes();
    p[P_FILESZ..P_FILESZ + 4].copy_from_slice(&code);
    p[P_MEMSZ..P_MEMSZ + 4].copy_from_slice(&code);
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
    fn default_program_is_22_instructions_in_328_bytes() {
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
        assert_eq!(p[p.len() - 8..], [EXIT, 0, 0, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn widths_cover_every_remainder() {
        assert_eq!(widths(8).collect::<Vec<_>>(), [8]);
        assert_eq!(widths(20).collect::<Vec<_>>(), [8, 8, 4]);
        assert_eq!(widths(7).collect::<Vec<_>>(), [4, 2, 1]);
        assert_eq!(widths(13).sum::<usize>(), 13);
    }

    #[test]
    fn large_payloads_use_memcpy() {
        let inline = generate(&ADMIN, 48);
        let memcpy = generate(&ADMIN, 56);
        assert!(memcpy.len() < inline.len());
        assert!(memcpy
            .windows(8)
            .any(|w| w == insn(CALL, 0, 0, 0, SOL_MEMCPY)));
        assert!(!inline
            .windows(8)
            .any(|w| w == insn(CALL, 0, 0, 0, SOL_MEMCPY)));
    }
}
