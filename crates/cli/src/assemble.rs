//! Assemble a minimal sBPF ELF that implements the Doppler oracle update instruction.
//!
//! The emitted program checks the transaction signer against a hardcoded admin key,
//! enforces counter monotonicity, then copies instruction data into the oracle account
//! (inline load/store pairs or `sol_memcpy_` for larger payloads).

use thiserror::Error;

use crate::config::SbpfArch;
use solana_pubkey::Pubkey as Address;

// ELF header (0x40) + program header (0x38); the loadable segment follows.
const HEADER_SIZE: usize = 0x78;
const E_FLAGS_OFFSET: usize = 0x30;
/// Offsets of the program header's `p_filesz` / `p_memsz` fields, patched per program.
const P_FILESZ_OFFSET: usize = 0x60;
const P_MEMSZ_OFFSET: usize = 0x68;

/// Sequence number prefix on both the instruction data and the oracle account.
const COUNTER_SIZE: usize = 8;
const ACCOUNT_COUNTER_OFFSET: u32 = 0x28c0;
/// Payload begins immediately after the counter in the account.
const ACCOUNT_PAYLOAD_OFFSET: u32 = ACCOUNT_COUNTER_OFFSET + COUNTER_SIZE as u32;
/// Payload begins immediately after the counter in the instruction data.
const IX_PAYLOAD_OFFSET: u32 = COUNTER_SIZE as u32;

/// At 7 inline chunks (2 CU each = 14) ties `sol_memcpy_` CU, so switch there to
/// keep CU flat while shrinking the binary; beyond 7, memcpy is also cheaper CU.
const MEMCPY_THRESHOLD: usize = 7;
/// `sol_memcpy_` syscall key — murmur3_32 hash of the symbol name.
const SOL_MEMCPY: u32 = 0x717c_c4a3;

/// Minimal ELF64 + program header stub; the sBPF body is appended after this.
const HEADER: [u8; 136] = [
    0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x03, 0x00, 0xf7, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
    0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x03, 0x00, 0x00, 0x00, 0x40, 0x00, 0x38, 0x00, 0x01, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x78, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
    0xd0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xd0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x69, 0x13, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x55, 0x03, 0x13, 0x00, 0xff, 0x01, 0x00, 0x00,
];

const EXIT: [u8; 8] = [0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
/// Store the instruction counter into the account (inline path only).
const UPDATE_COUNTER: [u8; 8] = [0x7b, 0x41, 0xc0, 0x28, 0x00, 0x00, 0x00, 0x00];

#[derive(Debug, Error, PartialEq)]
pub enum AssembleError {
    #[error("payloadSize must be a positive integer")]
    InvalidPayloadSize,
}

/// Generate a `.so`-ready binary for a fixed-size `Doppler<T>` oracle program.
///
/// `payload_size` is the generic payload length only; an 8-byte sequence counter is
/// always prepended, so the total account data size is `COUNTER_SIZE + payload_size`.
pub fn generate_binary(
    admin: &str,
    payload_size: u32,
    arch: SbpfArch,
) -> Result<Vec<u8>, AssembleError> {
    if payload_size == 0 {
        return Err(AssembleError::InvalidPayloadSize);
    }

    let admin = Address::from_str_const(admin);
    Ok(generate_program(
        admin.as_array(),
        COUNTER_SIZE as u32 + payload_size,
        arch,
    ))
}

/// Concatenate the ELF stub, signer check, and update body; patch header fields.
fn generate_program(admin: &[u8; 32], size: u32, arch: SbpfArch) -> Vec<u8> {
    let mut program = Vec::new();
    program.extend_from_slice(&HEADER);
    program.extend(signer_key_check(admin));
    program.extend(update_oracle(size));

    program.splice(
        E_FLAGS_OFFSET..E_FLAGS_OFFSET + 4,
        imm(arch.assembler_version()),
    );

    // `p_filesz` / `p_memsz` = the loadable segment: everything after the headers.
    let segment_size = program.len() - HEADER_SIZE;
    program.splice(
        P_FILESZ_OFFSET..P_FILESZ_OFFSET + 4,
        imm(segment_size as u32),
    );
    program.splice(P_MEMSZ_OFFSET..P_MEMSZ_OFFSET + 4, imm(segment_size as u32));

    program
}

/// Compare the transaction signer pubkey against the embedded admin key (four 8-byte chunks).
fn signer_key_check(admin: &[u8; 32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(128);
    for group in 0..4u8 {
        bytes.extend_from_slice(&[0x79, 0x13, 0x10 + group * 8, 0x00, 0x00, 0x00, 0x00, 0x00]);
        bytes.extend_from_slice(&[
            0x18,
            0x04,
            0x00,
            0x00,
            admin[(group * 8) as usize],
            admin[(group * 8 + 1) as usize],
            admin[(group * 8 + 2) as usize],
            admin[(group * 8 + 3) as usize],
            0x00,
            0x00,
            0x00,
            0x00,
            admin[(group * 8 + 4) as usize],
            admin[(group * 8 + 5) as usize],
            admin[(group * 8 + 6) as usize],
            admin[(group * 8 + 7) as usize],
        ]);
        bytes.extend_from_slice(&[0x5d, 0x43, 0x0f - group * 4, 0x00, 0x00, 0x00, 0x00, 0x00]);
    }
    bytes
}

/// Counter monotonicity gate: require the ix counter (r4) to exceed the stored one (r3).
///
/// On failure, set error code 1 in r0. The happy path jumps over the error handler.
/// With inline copies nothing touches r0 before the final exit, so the error path can
/// fall through. `sol_memcpy_` returns SUCCESS into r0, clobbering the error code, so
/// the memcpy path needs an explicit error `EXIT` before the write.
fn counter_gate(use_memcpy: bool) -> Vec<u8> {
    let mut bytes = vec![
        0x79,
        0x13,
        0xc0,
        0x28,
        0x00,
        0x00,
        0x00,
        0x00,
        0x79,
        0x24,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0xad,
        0x43,
        if use_memcpy { 0x02 } else { 0x01 },
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0xb7,
        0x00,
        0x00,
        0x00,
        0x01,
        0x00,
        0x00,
        0x00,
    ];
    if use_memcpy {
        bytes.extend_from_slice(&EXIT);
    }
    bytes
}

/// Split a byte length into 8/4/2/1-byte copy widths (greedy on 8-byte chunks first).
fn get_copies(size: u32) -> Vec<u8> {
    let mut copies = vec![8u8; (size >> 3) as usize];
    for width in [4u32, 2, 1] {
        if size & width != 0 {
            copies.push(width as u8);
        }
    }
    copies
}

/// Map a copy width to its `[ldx, stx]` opcode pair.
fn copy_opcodes(width: u8) -> (u8, u8) {
    match width {
        8 => (0x79, 0x7b), // ldxdw / stxdw
        4 => (0x61, 0x63), // ldxw  / stxw
        2 => (0x69, 0x6b), // ldxh  / stxh
        1 => (0x71, 0x73), // ldxb  / stxb
        _ => unreachable!(),
    }
}

/// Unrolled load/store pairs: load a chunk from ix data into r4, store into the account.
///
/// Both offsets advance by the same width, so one accumulator tracks both sides.
fn inline_payload(copies: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut offset = 0u32;
    for &width in copies {
        let (ldx, stx) = copy_opcodes(width);
        let ix = IX_PAYLOAD_OFFSET + offset;
        let account = ACCOUNT_PAYLOAD_OFFSET + offset;
        offset += width as u32;
        bytes.extend_from_slice(&[
            ldx,
            0x24,
            (ix & 0xff) as u8,
            (ix >> 8) as u8,
            0x00,
            0x00,
            0x00,
            0x00,
        ]);
        bytes.extend_from_slice(&[
            stx,
            0x41,
            (account & 0xff) as u8,
            (account >> 8) as u8,
            0x00,
            0x00,
            0x00,
            0x00,
        ]);
    }
    bytes
}

/// Emit `sol_memcpy_(dst = account + counter, src = ix data, n = r3)`.
///
/// The copy bundles counter + payload as one block: src is r2 as-is (ix offset 0),
/// so the counter is written here and needs no separate `UPDATE_COUNTER`.
fn memcpy_call() -> Vec<u8> {
    let mut bytes = vec![0x07, 0x01, 0x00, 0x00];
    bytes.extend(imm(ACCOUNT_COUNTER_OFFSET));
    bytes.extend_from_slice(&[0x85, 0x00, 0x00, 0x00]);
    bytes.extend(imm(SOL_MEMCPY));
    bytes
}

/// Fixed-size memcpy: `n = counter + payload length`, known at generation time.
fn memcpy_payload(size: u32) -> Vec<u8> {
    let mut bytes = vec![0xb7, 0x03, 0x00, 0x00];
    bytes.extend(imm(size));
    bytes.extend(memcpy_call());
    bytes
}

/// Gate counter, then copy payload (inline or via `sol_memcpy_`), then exit.
fn update_oracle(size: u32) -> Vec<u8> {
    let copies = get_copies(size - COUNTER_SIZE as u32);
    if copies.len() >= MEMCPY_THRESHOLD {
        let mut bytes = counter_gate(true);
        bytes.extend(memcpy_payload(size));
        bytes.extend_from_slice(&EXIT);
        return bytes;
    }

    // Inline path writes the counter separately, reusing r4 from the gate.
    let mut bytes = counter_gate(false);
    bytes.extend_from_slice(&UPDATE_COUNTER);
    bytes.extend(inline_payload(&copies));
    bytes.extend_from_slice(&EXIT);
    bytes
}

/// 32-bit little-endian immediate.
fn imm(n: u32) -> [u8; 4] {
    [
        (n & 0xff) as u8,
        ((n >> 8) & 0xff) as u8,
        ((n >> 16) & 0xff) as u8,
        (n >> 24) as u8,
    ]
}
