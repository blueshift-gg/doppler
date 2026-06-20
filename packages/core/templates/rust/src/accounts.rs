use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

use crate::constants::{ADMIN_VERIFICATION_CU, ID, PAYLOAD_WRITE_CU, SEQUENCE_CHECK_CU};

pub trait OraclePayload: Copy {
    const SIZE: usize;

    fn to_bytes(&self, data: &mut [u8]);

    fn from_bytes(data: &[u8]) -> Self;
}

#[derive(Clone, Copy, Debug)]
pub struct Oracle<T: OraclePayload> {
    pub sequence: u64,
    pub payload: T,
}

impl<T: OraclePayload> Oracle<T> {
    pub const SIZE: usize = 8 + T::SIZE;

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut data = vec![0; Self::SIZE];
        data[..8].copy_from_slice(&self.sequence.to_le_bytes());
        self.payload.to_bytes(&mut data[8..]);
        data
    }

    #[must_use]
    pub fn from_bytes(data: &[u8]) -> Self {
        assert!(data.len() == Self::SIZE);

        let mut seq_bytes = [0u8; 8];
        seq_bytes.copy_from_slice(&data[..8]);
        let sequence = u64::from_le_bytes(seq_bytes);
        let payload = T::from_bytes(&data[8..]);

        Self { sequence, payload }
    }
}

pub struct UpdateInstruction<T: OraclePayload> {
    pub admin: Pubkey,
    pub oracle_pubkey: Pubkey,
    pub oracle: Oracle<T>,
}

impl<T: OraclePayload> UpdateInstruction<T> {
    pub const fn compute_units(&self) -> u32 {
        SEQUENCE_CHECK_CU
            + ADMIN_VERIFICATION_CU
            + PAYLOAD_WRITE_CU
            + (Oracle::<T>::SIZE / 4) as u32
    }

    pub const fn loaded_accounts_data_size_limit(&self) -> u32 {
        Oracle::<T>::SIZE as u32
    }
}

impl<T: OraclePayload> From<UpdateInstruction<T>> for Instruction {
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
