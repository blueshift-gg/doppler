use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

// fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm
pub const ID: Pubkey = Pubkey::new_from_array([
    0x09, 0xe2, 0x60, 0x40, 0xff, 0x10, 0xec, 0xcf, 0xc1, 0x6a, 0xf6, 0x16, 0x9a, 0x68, 0x04, 0x78,
    0x15, 0x14, 0x33, 0x02, 0xac, 0x6e, 0x98, 0x5f, 0x70, 0x85, 0x53, 0xe1, 0x0a, 0xb6, 0xf9, 0x22,
]);

const SEQUENCE_CHECK_CU: u32 = 5;
const ADMIN_VERIFICATION_CU: u32 = 6;
const PAYLOAD_WRITE_CU: u32 = 6;

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Oracle<T: Sized + Copy> {
    pub sequence: u64,
    pub payload: T,
}

impl<T: Sized + Copy> Oracle<T> {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut data = Vec::with_capacity(core::mem::size_of::<Oracle<T>>());
        data.extend_from_slice(&self.sequence.to_le_bytes());
        data.extend_from_slice(unsafe {
            core::slice::from_raw_parts(
                core::ptr::from_ref(&self.payload) as *const u8,
                core::mem::size_of::<Oracle<T>>(),
            )
        });
        data
    }
}

pub struct UpdateInstruction<T: Sized + Copy> {
    pub admin: Pubkey,
    pub oracle_pubkey: Pubkey,
    pub oracle: Oracle<T>,
}

impl<T: Sized + Copy> UpdateInstruction<T> {
    pub fn compute_unit_limit(&self) -> Instruction {
        ComputeBudgetInstruction::set_compute_unit_limit(
            SEQUENCE_CHECK_CU
                + ADMIN_VERIFICATION_CU
                + PAYLOAD_WRITE_CU
                + (core::mem::size_of::<Oracle<T>>() / 4) as u32,
        )
    }
}

impl<T: Sized + Copy> From<UpdateInstruction<T>> for Instruction {
    fn from(update: UpdateInstruction<T>) -> Self {
        let data = update.oracle.to_bytes();

        Instruction {
            program_id: ID,
            accounts: vec![
                AccountMeta::new(update.admin, true),
                AccountMeta::new(update.oracle_pubkey, false),
            ],
            data,
        }
    }
}

#[cfg(test)]
mod tests {
    use doppler::PriceFeed;

    use super::*;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct PropAMM {
        pub bid: u64,
        pub ask: u64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct MarketData {
        pub price: u64,
        pub volume: u64,
        pub confidence: u32,
    }

    #[test]
    fn test_oracle_to_bytes() {
        let oracle = Oracle {
            sequence: 42,
            payload: 123u32,
        };

        let bytes = oracle.to_bytes();
        assert_eq!(bytes.len(), 24);
        assert_eq!(&bytes[0..8], &42u64.to_le_bytes());
        assert_eq!(&bytes[8..12], &123u32.to_le_bytes());
    }

    #[test]
    fn test_cu_limit_num_payload() {
        let admin = Pubkey::new_unique();
        let oracle_pubkey = Pubkey::new_unique();

        let oracle = Oracle {
            sequence: 1,
            payload: 789u64,
        };

        let update_instruction = UpdateInstruction {
            admin,
            oracle_pubkey,
            oracle,
        };

        let compute_instruction = update_instruction.compute_unit_limit();

        assert_eq!(
            compute_instruction,
            ComputeBudgetInstruction::set_compute_unit_limit(21)
        );
    }

    #[test]
    fn test_cu_limit_price_feed_payload() {
        let admin = Pubkey::new_unique();
        let oracle_pubkey = Pubkey::new_unique();

        let oracle = Oracle {
            sequence: 1,
            payload: PriceFeed { price: 1_100_000 },
        };

        let update_instruction = UpdateInstruction {
            admin,
            oracle_pubkey,
            oracle,
        };

        let compute_instruction = update_instruction.compute_unit_limit();

        assert_eq!(
            compute_instruction,
            ComputeBudgetInstruction::set_compute_unit_limit(21)
        );
    }

    #[test]
    fn test_cu_limit_prop_amm_payload() {
        let admin = Pubkey::new_unique();
        let oracle_pubkey = Pubkey::new_unique();

        let oracle = Oracle {
            sequence: 1,
            payload: PropAMM {
                bid: 10_500_000,
                ask: 10_550_000,
            },
        };

        let update_instruction = UpdateInstruction {
            admin,
            oracle_pubkey,
            oracle,
        };

        let compute_instruction = update_instruction.compute_unit_limit();

        assert_eq!(
            compute_instruction,
            ComputeBudgetInstruction::set_compute_unit_limit(23)
        );
    }

    #[test]
    fn test_cu_limit_market_data_payload() {
        let admin = Pubkey::new_unique();
        let oracle_pubkey = Pubkey::new_unique();

        let oracle = Oracle {
            sequence: 1,
            payload: MarketData {
                price: 45_000_000,
                volume: 150_000_000,
                confidence: 300,
            },
        };

        let update_instruction = UpdateInstruction {
            admin,
            oracle_pubkey,
            oracle,
        };

        let compute_instruction = update_instruction.compute_unit_limit();

        assert_eq!(
            compute_instruction,
            ComputeBudgetInstruction::set_compute_unit_limit(25)
        );
    }
}
