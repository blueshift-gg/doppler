use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

use crate::constants::{ADMIN_VERIFICATION_CU, ID, PAYLOAD_WRITE_CU, SEQUENCE_CHECK_CU};

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Oracle<T: Sized + Copy> {
    pub sequence: u64,
    pub payload: T,
}

impl<T: Sized + Copy> Oracle<T> {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut data = Vec::with_capacity(core::mem::size_of::<Self>());
        // write sequence bytes
        data.extend_from_slice(&self.sequence.to_le_bytes());
        // write payload bytes
        data.extend_from_slice(unsafe {
            core::slice::from_raw_parts(
                core::ptr::from_ref(&self.payload).cast::<u8>(),
                core::mem::size_of::<T>(),
            )
        });
        data
    }

    #[must_use]
    pub fn from_bytes(data: &[u8]) -> Self {
        assert!(data.len() == core::mem::size_of::<Self>());

        // read u64 sequence from first 8 bytes
        let mut seq_bytes = [0u8; 8];
        seq_bytes.copy_from_slice(&data[..8]);
        let sequence = u64::from_le_bytes(seq_bytes);

        // read payload from remaining bytes
        let payload = unsafe { *data[8..].as_ptr().cast::<T>() };

        Self { sequence, payload }
    }
}

pub struct UpdateInstruction<T: Sized + Copy> {
    pub admin: Pubkey,
    pub oracle_pubkey: Pubkey,
    pub oracle: Oracle<T>,
}

impl<T: Sized + Copy> UpdateInstruction<T> {
    pub fn new(admin: Pubkey, oracle_pubkey: Pubkey, sequence: u64, payload: T) -> Self {
        Self {
            admin,
            oracle_pubkey,
            oracle: Oracle { sequence, payload },
        }
    }
    pub const fn compute_units(&self) -> u32 {
        SEQUENCE_CHECK_CU
            + ADMIN_VERIFICATION_CU
            + PAYLOAD_WRITE_CU
            + (core::mem::size_of::<Oracle<T>>() / 4) as u32
    }

    pub const fn loaded_accounts_data_size_limit(&self) -> u32 {
        core::mem::size_of::<Oracle<T>>() as u32
    }
}

impl<T: Sized + Copy> From<UpdateInstruction<T>> for Instruction {
    fn from(update: UpdateInstruction<T>) -> Self {
        let data = update.oracle.to_bytes();

        Self {
            program_id: ID,
            accounts: vec![
                AccountMeta::new_readonly(update.admin, true),
                AccountMeta::new(update.oracle_pubkey, false),
            ],
            data,
        }
    }
}

#[cfg(test)]
mod tests {
    use doppler_program::PriceFeed;
    use solana_pubkey::Pubkey;

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
        assert_eq!(bytes.len(), 12);
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

        let compute_instruction = update_instruction.compute_units();

        assert_eq!(compute_instruction, 21);
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

        let compute_instruction = update_instruction.compute_units();

        assert_eq!(compute_instruction, 21);
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

        let compute_instruction = update_instruction.compute_units();

        assert_eq!(compute_instruction, 23);
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

        let compute_instruction = update_instruction.compute_units();

        assert_eq!(compute_instruction, 25);
    }
}
