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
