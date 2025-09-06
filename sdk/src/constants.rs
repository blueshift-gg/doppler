use solana_pubkey::Pubkey;

// fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm
pub const ID: Pubkey = Pubkey::new_from_array([
    0x09, 0xe2, 0x60, 0x40, 0xff, 0x10, 0xec, 0xcf, 0xc1, 0x6a, 0xf6, 0x16, 0x9a, 0x68, 0x04, 0x78,
    0x15, 0x14, 0x33, 0x02, 0xac, 0x6e, 0x98, 0x5f, 0x70, 0x85, 0x53, 0xe1, 0x0a, 0xb6, 0xf9, 0x22,
]);

pub const SEQUENCE_CHECK_CU: u32 = 5;
pub const ADMIN_VERIFICATION_CU: u32 = 6;
pub const PAYLOAD_WRITE_CU: u32 = 6;

pub const COMPUTE_BUDGET_IX_CU: u32 = 150;
pub const COMPUTE_BUDGET_UNIT_PRICE_SIZE: u32 = 9;
pub const COMPUTE_BUDGET_UNIT_LIMIT_SIZE: u32 = 5;
pub const COMPUTE_BUDGET_DATA_LIMIT_SIZE: u32 = 5;
pub const COMPUTE_BUDGET_PROGRAM_SIZE: u32 = 22;
pub const ORACLE_PROGRAM_SIZE: u32 = 36;
