// Reduces one 64-byte SHA-512 digest mod L = 2^252 + c, the way ref10's `sc_reduce` does, with
// 28-bit limbs: 252 is nine of them exactly, so 2^252 ≡ -c folds a limb into the five below it,
// and products of 56 bits leave room to accumulate before a carry. Signed limbs, rounding carries
// between the fold groups, floor carries at the end, as in ref10.

const BITS: u32 = 28;
const MASK: i64 = (1 << BITS) - 1;
/// c in 28-bit limbs.
const C: [i64; 5] = [0xcf5d3ed, 0x12631a5, 0x79cd658, 0xf9dea2f, 0x14de];

#[inline(always)]
unsafe fn limb(input: *const u8, i: usize) -> i64 {
    let bit = BITS as usize * i;
    if i == 18 {
        return input.add(63).read() as i64;
    }
    ((input.add(bit / 8).cast::<u32>().read_unaligned() >> (bit % 8)) as i64) & MASK
}

#[inline(always)]
pub(crate) fn reduce(input: &mut [u8; 64]) {
    let p = input.as_ptr();
    let mut s: [i64; 19] = core::array::from_fn(|i| unsafe { limb(p, i) });

    macro_rules! fold {
        ($i:expr) => {{
            let x = s[$i];
            s[$i - 9] -= x * C[0];
            s[$i - 8] -= x * C[1];
            s[$i - 7] -= x * C[2];
            s[$i - 6] -= x * C[3];
            s[$i - 5] -= x * C[4];
            s[$i] = 0;
        }};
    }
    macro_rules! carry_round {
        ($i:expr) => {{
            let carry = (s[$i] + (1 << (BITS - 1))) >> BITS;
            s[$i + 1] += carry;
            s[$i] -= carry << BITS;
        }};
    }
    macro_rules! carry {
        ($i:expr) => {{
            let carry = s[$i] >> BITS;
            s[$i + 1] += carry;
            s[$i] -= carry << BITS;
        }};
    }

    // Fold the top five limbs into 5..13, then bring 5..13 back to 28 bits; 13 carries into 14.
    fold!(18);
    fold!(17);
    fold!(16);
    fold!(15);
    fold!(14);

    carry_round!(5);
    carry_round!(7);
    carry_round!(9);
    carry_round!(11);
    carry_round!(13);
    carry_round!(6);
    carry_round!(8);
    carry_round!(10);
    carry_round!(12);

    // Fold 14..9 into 0..8, then bring 0..8 back to 28 bits; 8 carries into 9.
    fold!(14);
    fold!(13);
    fold!(12);
    fold!(11);
    fold!(10);
    fold!(9);

    carry_round!(0);
    carry_round!(2);
    carry_round!(4);
    carry_round!(6);
    carry_round!(8);
    carry_round!(1);
    carry_round!(3);
    carry_round!(5);
    carry_round!(7);

    // Fold 9 away with floor carries, twice, so every limb is in [0, 2^28) and the value below 2^252.
    fold!(9);

    carry!(0);
    carry!(1);
    carry!(2);
    carry!(3);
    carry!(4);
    carry!(5);
    carry!(6);
    carry!(7);
    carry!(8);

    fold!(9);

    carry!(0);
    carry!(1);
    carry!(2);
    carry!(3);
    carry!(4);
    carry!(5);
    carry!(6);
    carry!(7);

    let out = input.as_mut_ptr().wrapping_add(32).cast::<u64>();
    let limb = |i: usize| s[i] as u64;
    unsafe {
        out.write_unaligned(limb(0) | limb(1) << 28 | limb(2) << 56);
        out.add(1)
            .write_unaligned(limb(2) >> 8 | limb(3) << 20 | limb(4) << 48);
        out.add(2)
            .write_unaligned(limb(4) >> 16 | limb(5) << 12 | limb(6) << 40);
        out.add(3)
            .write_unaligned(limb(6) >> 24 | limb(7) << 4 | limb(8) << 32);
    }
}

#[cfg(test)]
mod tests {
    use super::reduce;
    use curve25519_dalek::scalar::Scalar;

    fn bytes(mut state: u64) -> [u8; 64] {
        let mut bytes = [0; 64];
        for chunk in bytes.as_chunks_mut::<8>().0 {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            *chunk = state.to_le_bytes();
        }
        bytes
    }

    fn assert_matches(mut input: [u8; 64]) {
        let expected = Scalar::from_bytes_mod_order_wide(&input).to_bytes();
        reduce(&mut input);
        assert_eq!(input[32..], expected, "{:?}", &input[..32]);
    }

    #[test]
    fn matches_dalek() {
        assert_matches([0; 64]);
        assert_matches([0xff; 64]);
        assert_matches(core::array::from_fn(|i| i as u8));
        for bit in 0..512 {
            let mut input = [0; 64];
            input[bit / 8] = 1 << (bit % 8);
            assert_matches(input);
            input = [0xff; 64];
            input[bit / 8] ^= 1 << (bit % 8);
            assert_matches(input);
        }
        let l: [u8; 32] = [
            0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9,
            0xde, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10,
        ];
        for k in 0..64u8 {
            let mut input = [0; 64];
            input[..32].copy_from_slice(&l);
            input[0] = input[0].wrapping_add(k).wrapping_sub(32);
            assert_matches(input);
        }
        for seed in 1..=100_000 {
            assert_matches(bytes(seed));
        }
    }
}
