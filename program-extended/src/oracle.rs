use crate::{fail, read, ADMIN, BAD_SIGNATURE, ID, STALE, WRONG_SIGNER};
use solana_define_syscall::definitions::sol_memcpy_;

/// The payload as stored: whole 8-byte chunks.
const fn padded(value: usize) -> usize {
    value.div_ceil(8) * 8
}

// The input as the loader serializes it: the account count, then per account an 8-byte header
// (duplicate marker, is_signer, is_writable, executable, padding), key, owner, lamports, data
// length, data, 10240 bytes of realloc room padded to 8, rent epoch; then the instruction data
// length, the data, the program id. Account 0 is the feed.
const DATA_LEN: usize = 8 + 8 + 32 + 32 + 8;
const DATA: usize = DATA_LEN + 8;
const fn instruction_data_len(feed: usize) -> usize {
    DATA + padded(feed + 10240) + 8
}

const ACCOUNT_COUNT: usize = 0;
const SIGNATURE: usize = 64;

/// The instruction data is the admin's signature over `DOMAIN ‖ ID ‖ update`, then the update: the
/// sequence and the payload, exactly the feed's size. A repeat of the current sequence with the
/// same payload succeeds without verifying, so several relayers may land one update.
#[inline(always)]
pub unsafe fn pull(input: *mut u8) {
    let feed = read::<u64>(input, DATA_LEN) as usize;
    let data_len = instruction_data_len(feed);
    if read::<u64>(input, ACCOUNT_COUNT) != 1
        || feed & 7 != 0
        || read::<u64>(input, data_len) != (SIGNATURE + feed) as u64
    {
        fail(WRONG_SIGNER);
    }

    let signature = &*input.add(data_len + 8).cast::<[u8; SIGNATURE]>();
    let update = input.add(data_len + 8 + SIGNATURE);
    let sequence = read::<u64>(update, 0);
    let current = read::<u64>(input, DATA);
    if sequence < current {
        fail(STALE);
    }
    if sequence == current {
        let (mut new, mut old) = (update.add(8), input.add(DATA + 8));
        while new < update.add(feed) {
            if read::<u64>(new, 0) != read::<u64>(old, 0) {
                fail(STALE);
            }
            new = new.add(8);
            old = old.add(8);
        }
        return;
    }

    let update = core::slice::from_raw_parts(update, feed);
    let admin = solana_address::Address::new_from_array(core::ptr::read_volatile(&ADMIN));
    if brine_ed25519::verify(
        &admin,
        signature,
        &[doppler::DOMAIN, &*core::ptr::addr_of!(ID), update],
    )
    .is_err()
    {
        fail(BAD_SIGNATURE);
    }
    sol_memcpy_(input.add(DATA), update.as_ptr(), feed as u64);
}
