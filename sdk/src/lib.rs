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

#[derive(Debug, Clone, Copy)]
pub struct ComputeOptimizer {
    pub base_cu: u32,
    pub network_congestion_factor: u32,
}

impl ComputeOptimizer {
    pub fn new() -> Self {
        Self {
            base_cu: 21,
            network_congestion_factor: 1,
        }
    }
    
    pub fn calculate_optimal_cu<T: Sized + Copy>(&self, _payload: &T) -> u32 {
        let payload_size = core::mem::size_of::<T>();
        let size_factor = (payload_size / 8) as u32;
        
        self.base_cu + size_factor + self.network_congestion_factor
    }
    
    pub fn adjust_for_congestion(&mut self, recent_fees: &[u64]) -> u32 {
        if let Some(avg_fee) = recent_fees.iter().sum::<u64>().checked_div(recent_fees.len() as u64) {
            self.network_congestion_factor = match avg_fee {
                0..=100 => 0,
                101..=500 => 1,
                501..=1000 => 2,
                _ => 3,
            };
        }
        self.network_congestion_factor
    }
}

pub struct UpdateInstruction<T: Sized + Copy> {
    pub admin: Pubkey,
    pub oracle_pubkey: Pubkey,
    pub oracle: Oracle<T>,
}

impl<T: Sized + Copy> UpdateInstruction<T> {
    pub const fn compute_unit_limit(&self) -> u32 {
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

        let compute_instruction = update_instruction.compute_unit_limit();

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

        let compute_instruction = update_instruction.compute_unit_limit();

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

        let compute_instruction = update_instruction.compute_unit_limit();

        assert_eq!(compute_instruction, 25);
    }

    // ComputeOptimizer tests
    #[test]
    fn test_compute_optimizer_new() {
        let optimizer = ComputeOptimizer::new();
        assert_eq!(optimizer.base_cu, 21);
        assert_eq!(optimizer.network_congestion_factor, 1);
    }

    #[test]
    fn test_compute_optimizer_calculate_optimal_cu() {
        let optimizer = ComputeOptimizer::new();
        
        let payload = 123u64;
        let optimal_cu = optimizer.calculate_optimal_cu(&payload);
        assert_eq!(optimal_cu, 23);
        
        let amm_payload = PropAMM { bid: 1000, ask: 1100 };
        let optimal_cu = optimizer.calculate_optimal_cu(&amm_payload);
        assert_eq!(optimal_cu, 24);
    }

    #[test]
    fn test_compute_optimizer_adjust_for_congestion() {
        let mut optimizer = ComputeOptimizer::new();
        
        let low_fees = vec![50, 75, 100];
        let factor = optimizer.adjust_for_congestion(&low_fees);
        assert_eq!(factor, 0);
        
        let high_fees = vec![600, 700, 800];
        let factor = optimizer.adjust_for_congestion(&high_fees);
        assert_eq!(factor, 2);
    }

}
