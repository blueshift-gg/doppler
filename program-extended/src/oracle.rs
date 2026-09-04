use core::marker::PhantomData;

use crate::{
    ed25519::signature_valid, fail, read, write, ADMIN, BAD_SIGNATURE, STALE, WRONG_SIGNER,
};

/// The payload as stored: whole 8-byte chunks.
const fn padded(value: usize) -> usize {
    value.div_ceil(8) * 8
}

// The input as the loader serializes it: the account count, then per account an 8-byte header
// (duplicate marker, is_signer, is_writable, executable, padding), key, owner, lamports, data
// length, data, 10240 bytes of realloc room padded to 8, rent epoch; then the instruction data
// length, the data, the program id.
const HEADER: usize = 8;
const KEY: usize = HEADER;
const DATA_LEN: usize = HEADER + 32 + 32 + 8;
const DATA: usize = DATA_LEN + 8;
const fn account(data_len: usize) -> usize {
    DATA + padded(data_len + 10240) + 8
}

/// Push: account 0 is the admin, account 1 the feed. Pull: account 0 is the feed.
const ACCOUNT_COUNT: usize = 0;
/// The duplicate marker, then `is_signer`.
const ADMIN_FLAGS: usize = 8;
const ADMIN_KEY: usize = 8 + KEY;
const PUSH_FEED_DATA: usize = 8 + account(0) + DATA;
const PULL_FEED_DATA_LEN: usize = 8 + DATA_LEN;
const PULL_FEED_DATA: usize = 8 + DATA;

/// Not a duplicate, and a signer.
const NOT_DUP_SIGNER: u16 = 0x01ff;
const SIGNATURE: usize = 64;

const ADMIN_WORDS: [u64; 4] = {
    let mut words = [0; 4];
    let mut i = 0;
    while i < 4 {
        words[i] = u64::from_le_bytes([
            ADMIN[8 * i],
            ADMIN[8 * i + 1],
            ADMIN[8 * i + 2],
            ADMIN[8 * i + 3],
            ADMIN[8 * i + 4],
            ADMIN[8 * i + 5],
            ADMIN[8 * i + 6],
            ADMIN[8 * i + 7],
        ]);
        i += 1;
    }
    words
};

pub struct Oracle<T>(PhantomData<T>);

impl<T: Copy + PartialEq> Oracle<T> {
    /// Sequence, then the payload.
    const FEED: usize = 8 + core::mem::size_of::<T>();
    const PUSH_INSTRUCTION_DATA: usize = 8 + account(0) + account(Self::FEED) + 8;
    const PULL_INSTRUCTION_DATA_LEN: usize = 8 + account(Self::FEED);
    const PULL_INSTRUCTION_DATA: usize = Self::PULL_INSTRUCTION_DATA_LEN + 8;

    /// The admin's signed transaction, or anyone's with the admin's detached signature.
    #[inline(always)]
    pub unsafe fn update(input: *mut u8) {
        if read::<u16>(input, ADMIN_FLAGS) == NOT_DUP_SIGNER {
            Self::push(input)
        } else {
            Self::pull(input)
        }
    }

    #[inline(always)]
    unsafe fn push(input: *mut u8) {
        if read::<u64>(input, ADMIN_KEY) != ADMIN_WORDS[0]
            || read::<u64>(input, ADMIN_KEY + 8) != ADMIN_WORDS[1]
            || read::<u64>(input, ADMIN_KEY + 16) != ADMIN_WORDS[2]
            || read::<u64>(input, ADMIN_KEY + 24) != ADMIN_WORDS[3]
        {
            fail(WRONG_SIGNER);
        }

        let update = input.add(Self::PUSH_INSTRUCTION_DATA);
        let sequence = read::<u64>(update, 0);
        if sequence <= read::<u64>(input, PUSH_FEED_DATA) {
            fail(STALE);
        }

        write(input, PUSH_FEED_DATA + 8, read::<T>(update, 8));
        write(input, PUSH_FEED_DATA, sequence);
    }

    /// The instruction data is the signature over `DOMAIN ‖ ID ‖ update`, then the update. A repeat
    /// of the current sequence with the same payload succeeds without verifying, so several
    /// relayers may land one update.
    #[inline(always)]
    unsafe fn pull(input: *mut u8) {
        if read::<u64>(input, ACCOUNT_COUNT) != 1
            || read::<u64>(input, PULL_FEED_DATA_LEN) != Self::FEED as u64
            || read::<u64>(input, Self::PULL_INSTRUCTION_DATA_LEN)
                != (SIGNATURE + Self::FEED) as u64
        {
            fail(WRONG_SIGNER);
        }

        let signature = &*input
            .add(Self::PULL_INSTRUCTION_DATA)
            .cast::<[u8; SIGNATURE]>();
        let update = core::slice::from_raw_parts(
            input.add(Self::PULL_INSTRUCTION_DATA + SIGNATURE),
            Self::FEED,
        );
        let sequence = read::<u64>(update.as_ptr(), 0);
        let current = read::<u64>(input, PULL_FEED_DATA);

        if sequence < current {
            fail(STALE);
        }
        if sequence == current {
            if read::<T>(update.as_ptr(), 8) == read::<T>(input, PULL_FEED_DATA + 8) {
                return;
            }
            fail(STALE);
        }

        if !signature_valid(signature, update) {
            fail(BAD_SIGNATURE);
        }

        write(input, PULL_FEED_DATA, sequence);
        write(input, PULL_FEED_DATA + 8, read::<T>(update.as_ptr(), 8));
    }
}
