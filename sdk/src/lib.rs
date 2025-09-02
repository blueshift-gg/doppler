use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

// fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm
pub const ID: Pubkey = Pubkey::new_from_array([
    0x09, 0xe2, 0x60, 0x40, 0xff, 0x10, 0xec, 0xcf, 0xc1, 0x6a, 0xf6, 0x16, 0x9a, 0x68, 0x04, 0x78,
    0x15, 0x14, 0x33, 0x02, 0xac, 0x6e, 0x98, 0x5f, 0x70, 0x85, 0x53, 0xe1, 0x0a, 0xb6, 0xf9, 0x22,
]);

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
