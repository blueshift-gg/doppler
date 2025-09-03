use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

// Doppler Pro - Enterprise Oracle Program ID
pub const ID: Pubkey = Pubkey::new_from_array([
    0x09, 0xe2, 0x60, 0x40, 0xff, 0x10, 0xec, 0xcf, 0xc1, 0x6a, 0xf6, 0x16, 0x9a, 0x68, 0x04, 0x78,
    0x15, 0x14, 0x33, 0x02, 0xac, 0x6e, 0x98, 0x5f, 0x70, 0x85, 0x53, 0xe1, 0x0a, 0xb6, 0xf9, 0x22,
]);

// Compute Unit constants for Doppler Pro
const SEQUENCE_CHECK_CU: u32 = 5;
const ADMIN_VERIFICATION_CU: u32 = 6;
const PAYLOAD_WRITE_CU: u32 = 6;
const MONITORING_CU: u32 = 4;

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Oracle<T: Sized + Copy> {
    pub sequence: u64,
    pub payload: T,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct BatchUpdate<T: Sized + Copy> {
    pub updates: [Oracle<T>; 8], // Support up to 8 updates in a batch
    pub count: u8,
}

impl<T: Sized + Copy> Oracle<T> {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut data = Vec::with_capacity(core::mem::size_of::<Oracle<T>>());
        data.extend_from_slice(&self.sequence.to_le_bytes());
        data.extend_from_slice(unsafe {
            core::slice::from_raw_parts(
                core::ptr::from_ref(&self.payload) as *const u8,
                core::mem::size_of::<T>(),
            )
        });
        data
    }
}

impl<T: Sized + Copy> BatchUpdate<T> {
    pub fn new() -> Self {
        Self {
            updates: [Oracle {
                sequence: 0,
                payload: unsafe { core::mem::zeroed() },
            }; 8],
            count: 0,
        }
    }
    
    pub fn add_update(&mut self, oracle: Oracle<T>) -> Result<(), &'static str> {
        if self.count >= 8 {
            return Err("Batch is full (max 8 updates)");
        }
        self.updates[self.count as usize] = oracle;
        self.count += 1;
        Ok(())
    }
    
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut data = Vec::new();
        for i in 0..self.count {
            data.extend_from_slice(&self.updates[i as usize].to_bytes());
        }
        data.push(self.count);
        data
    }
}

pub struct UpdateInstruction<T: Sized + Copy> {
    pub admin: Pubkey,
    pub oracle_pubkey: Pubkey,
    pub oracle: Oracle<T>,
}

pub struct BatchUpdateInstruction<T: Sized + Copy> {
    pub admin: Pubkey,
    pub oracle_pubkey: Pubkey,
    pub batch: BatchUpdate<T>,
}

impl<T: Sized + Copy> UpdateInstruction<T> {
    pub const fn compute_unit_limit(&self) -> u32 {
        SEQUENCE_CHECK_CU
            + ADMIN_VERIFICATION_CU
            + PAYLOAD_WRITE_CU
            + MONITORING_CU
            + (core::mem::size_of::<Oracle<T>>() / 4) as u32
    }

    pub const fn loaded_accounts_data_size_limit(&self) -> u32 {
        core::mem::size_of::<Oracle<T>>() as u32
    }
}

impl<T: Sized + Copy> BatchUpdateInstruction<T> {
    pub const fn compute_unit_limit(&self) -> u32 {
        SEQUENCE_CHECK_CU
            + ADMIN_VERIFICATION_CU
            + (PAYLOAD_WRITE_CU * self.batch.count as u32)
            + MONITORING_CU
            + (core::mem::size_of::<BatchUpdate<T>>() / 4) as u32
    }

    pub const fn loaded_accounts_data_size_limit(&self) -> u32 {
        core::mem::size_of::<BatchUpdate<T>>() as u32
    }
}

impl<T: Sized + Copy> From<UpdateInstruction<T>> for Instruction {
    fn from(update: UpdateInstruction<T>) -> Self {
        let data = update.oracle.to_bytes();

        Instruction {
            program_id: ID,
            accounts: vec![
                AccountMeta::new_readonly(update.admin, true),
                AccountMeta::new(update.oracle_pubkey, false),
            ],
            data,
        }
    }
}

impl<T: Sized + Copy> From<BatchUpdateInstruction<T>> for Instruction {
    fn from(update: BatchUpdateInstruction<T>) -> Self {
        let data = update.batch.to_bytes();

        Instruction {
            program_id: ID,
            accounts: vec![
                AccountMeta::new_readonly(update.admin, true),
                AccountMeta::new(update.oracle_pubkey, false),
            ],
            data,
        }
    }
}

// Monitoring data structure
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct MonitoringData {
    pub update_count: u64,
    pub last_update_timestamp: u64,
    pub average_cu_usage: u32,
    pub total_cu_usage: u64,
    pub error_count: u32,
    pub batch_update_count: u32,
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
        assert_eq!(bytes.len(), 12); // 8 bytes sequence + 4 bytes payload (u32)
        assert_eq!(&bytes[0..8], &42u64.to_le_bytes());
        assert_eq!(&bytes[8..12], &123u32.to_le_bytes());
    }

    #[test]
    fn test_batch_update() {
        let mut batch = BatchUpdate::new();
        
        let oracle1 = Oracle {
            sequence: 1,
            payload: PriceFeed { price: 1000 },
        };
        
        let oracle2 = Oracle {
            sequence: 2,
            payload: PriceFeed { price: 2000 },
        };
        
        assert!(batch.add_update(oracle1).is_ok());
        assert!(batch.add_update(oracle2).is_ok());
        assert_eq!(batch.count, 2);
        
        let bytes = batch.to_bytes();
        // PriceFeed is 8 bytes, Oracle adds 8 bytes for sequence, total = 16 per update
        // 2 updates = 32 bytes + 1 byte count = 33 bytes
        assert_eq!(bytes.len(), 33);
    }

    #[test]
    fn test_cu_limit_single_update() {
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
        assert_eq!(compute_instruction, 25); // 5 + 6 + 6 + 4 + 4 = 25 CUs
    }

    #[test]
    fn test_cu_limit_batch_update() {
        let admin = Pubkey::new_unique();
        let oracle_pubkey = Pubkey::new_unique();

        let mut batch = BatchUpdate::new();
        for i in 1..=3 {
            let oracle = Oracle {
                sequence: i,
                payload: PriceFeed { price: i * 1000 },
            };
            batch.add_update(oracle).unwrap();
        }

        let batch_instruction = BatchUpdateInstruction {
            admin,
            oracle_pubkey,
            batch,
        };

        let compute_instruction = batch_instruction.compute_unit_limit();
        // 5 + 6 + (6 * 3) + 4 + 4 = 5 + 6 + 18 + 4 + 4 = 37 CUs
        // But with batch size overhead, it's actually 67 CUs
        assert_eq!(compute_instruction, 67);
    }
}
