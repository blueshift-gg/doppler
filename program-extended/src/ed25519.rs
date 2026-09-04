// Ed25519 for one immutable admin and one message shape: the challenge through `sol_sha512`, the
// equation through one `sol_curve_multiscalar_mul`, the way brine-ed25519 first did it on Solana.
// The admin is negated at build time instead of the base point, so the result is compared with R
// as signed and nothing about R is special-cased.

#[cfg(any(target_os = "solana", test))]
mod scalar;

#[cfg(any(target_os = "solana", test))]
use crate::ADMIN;
#[cfg(target_os = "solana")]
use crate::ID;

/// A leading 0xff is not a legacy header (255 required signers) and not a versioned prefix, so
/// no transaction the admin signs can be replayed as a pull, nor a pull as a transaction.
pub const DOMAIN: &[u8] = b"\xffdoppler:pull:v1";

/// The base point.
#[cfg(any(target_os = "solana", test))]
const G: [u8; 32] = [
    88, 102, 102, 102, 102, 102, 102, 102, 102, 102, 102, 102, 102, 102, 102, 102, 102, 102, 102,
    102, 102, 102, 102, 102, 102, 102, 102, 102, 102, 102, 102, 102,
];

/// -A: the compressed encoding with the sign bit flipped. A valid point unless A has x = 0, which
/// no honestly generated key does; tests::negated_admin_is_a_point checks it.
#[cfg(any(target_os = "solana", test))]
const NEG_ADMIN: [u8; 32] = {
    let mut point = ADMIN;
    point[31] ^= 0x80;
    point
};

#[cfg(target_os = "solana")]
const POINTS: [[u8; 32]; 2] = [G, NEG_ADMIN];

/// A ‖ DOMAIN ‖ ID: what precedes the update in the challenge hash.
#[cfg(target_os = "solana")]
const CHALLENGE_PREFIX: [u8; 32 + DOMAIN.len() + 32] = {
    let mut bytes = [0; 32 + DOMAIN.len() + 32];
    let mut i = 0;
    while i < 32 {
        bytes[i] = ADMIN[i];
        bytes[32 + DOMAIN.len() + i] = ID[i];
        i += 1;
    }
    i = 0;
    while i < DOMAIN.len() {
        bytes[32 + i] = DOMAIN[i];
        i += 1;
    }
    bytes
};

#[cfg(target_os = "solana")]
#[repr(C)]
struct Slice {
    address: u64,
    length: u64,
}

/// `[s]B + [k](-A) == R`, with `k = SHA-512(R ‖ A ‖ DOMAIN ‖ ID ‖ update) mod L`. The syscall
/// rejects a non-canonical `s`.
#[cfg(target_os = "solana")]
#[inline(always)]
pub(crate) fn signature_valid(signature: &[u8; 64], update: &[u8]) -> bool {
    use solana_define_syscall::{
        curve_constants::CURVE25519_EDWARDS,
        definitions::{sol_curve_multiscalar_mul, sol_sha512},
    };

    let slices = [
        Slice {
            address: signature.as_ptr() as u64,
            length: 32,
        },
        Slice {
            address: CHALLENGE_PREFIX.as_ptr() as u64,
            length: CHALLENGE_PREFIX.len() as u64,
        },
        Slice {
            address: update.as_ptr() as u64,
            length: update.len() as u64,
        },
    ];
    let mut challenge = core::mem::MaybeUninit::<[u8; 64]>::uninit();
    unsafe {
        sol_sha512(
            slices.as_ptr().cast(),
            slices.len() as u64,
            challenge.as_mut_ptr().cast(),
        );
    }
    let scalars = unsafe { challenge.assume_init_mut() };
    scalar::reduce(scalars);
    scalars[..32].copy_from_slice(&signature[32..]);

    // The syscall reads both scalars before it writes, so the first is the result buffer.
    let computed = unsafe {
        sol_curve_multiscalar_mul(
            CURVE25519_EDWARDS,
            scalars.as_ptr(),
            POINTS.as_ptr().cast(),
            2,
            scalars.as_mut_ptr(),
        )
    };
    computed == 0 && scalars[..32] == signature[..32]
}

#[cfg(test)]
mod tests {
    use super::*;
    use curve25519_dalek::edwards::CompressedEdwardsY;

    #[test]
    fn negated_admin_is_a_point() {
        let admin = CompressedEdwardsY(ADMIN).decompress().unwrap();
        let negated = CompressedEdwardsY(NEG_ADMIN).decompress().unwrap();
        assert_eq!(negated, -admin);
        assert_eq!(
            CompressedEdwardsY(G).decompress().unwrap(),
            curve25519_dalek::constants::ED25519_BASEPOINT_POINT
        );
    }
}
