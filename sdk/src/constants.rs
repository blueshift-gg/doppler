use solana_pubkey::Pubkey;

// fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm
pub const ID: Pubkey = Pubkey::new_from_array([
    0x09, 0xe2, 0x60, 0x40, 0xff, 0x10, 0xec, 0xcf, 0xc1, 0x6a, 0xf6, 0x16, 0x9a, 0x68, 0x04, 0x78,
    0x15, 0x14, 0x33, 0x02, 0xac, 0x6e, 0x98, 0x5f, 0x70, 0x85, 0x53, 0xe1, 0x0a, 0xb6, 0xf9, 0x22,
]);

pub(crate) const SEQUENCE_CHECK_CU: u32 = 5;
pub(crate) const ADMIN_VERIFICATION_CU: u32 = 6;
pub(crate) const PAYLOAD_WRITE_CU: u32 = 6;

pub(crate) const COMPUTE_BUDGET_IX_CU: u32 = 150;

// SIMD-0186: each unique loaded account counts `data_len + ACCOUNT_METADATA`.
pub(crate) const ACCOUNT_METADATA: u32 = 64;

// ComputeBudget program account data length.
pub(crate) const COMPUTE_BUDGET_PROGRAM_SIZE: u32 = 22;

// doppler program account (LoaderV3 `Program`: 4-byte tag + 32-byte programdata key).
pub(crate) const DOPPLER_PROGRAM_SIZE: u32 = 36;

// doppler program binary size (bytes): the size of the stripped deploy artifact
// (`target/deploy/doppler_program.so`). Pinned statically to the validator-confirmed
// value; if the program is rebuilt with a different toolchain, re-measure the artifact
// and update this constant (and the `loaded_accounts_data_size` tests).
pub(crate) const DOPPLER_BINARY_SIZE: u32 = 1136;

// programdata account: 45-byte LoaderV3 header + program binary. Assumes an exact-fit
// deploy; a `solana program deploy` with upgrade headroom allocates ~2x the binary,
// which this does not model.
pub(crate) const DOPPLER_PROGRAM_DATA_SIZE: u32 = 45 + DOPPLER_BINARY_SIZE;
