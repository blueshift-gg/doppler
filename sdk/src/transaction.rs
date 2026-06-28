use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_hash::Hash;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer as _;
use solana_transaction::Transaction;

use crate::accounts::{Oracle, UpdateInstruction};
use crate::constants::{
    ACCOUNT_METADATA, COMPUTE_BUDGET_IX_CU, COMPUTE_BUDGET_PROGRAM_SIZE, DOPPLER_PROGRAM_DATA_SIZE,
    DOPPLER_PROGRAM_SIZE,
};

pub struct Builder<'a> {
    oracle_update_ixs: Vec<Instruction>,
    admin: &'a Keypair,
    unit_price: Option<u64>,
    compute_units: u32,
    loaded_account_data_size: u32,
}

impl<'a> Builder<'a> {
    #[must_use]
    pub const fn new(admin: &'a Keypair) -> Self {
        Self {
            admin,
            oracle_update_ixs: vec![],
            unit_price: None,
            compute_units: COMPUTE_BUDGET_IX_CU * 2, // default 2 compute budget ixs
            // Always-loaded accounts: fee payer, ComputeBudget program (the tx
            // always carries CU/data-size limit ixs), doppler program, programdata.
            loaded_account_data_size: 4 * ACCOUNT_METADATA
                + COMPUTE_BUDGET_PROGRAM_SIZE
                + DOPPLER_PROGRAM_SIZE
                + DOPPLER_PROGRAM_DATA_SIZE,
        }
    }

    pub fn add_oracle_update<T: Sized + Copy>(
        mut self,
        oracle_pubkey: Pubkey,
        oracle: Oracle<T>,
    ) -> Self {
        let update_ix = UpdateInstruction {
            admin: self.admin.pubkey(),
            oracle_pubkey,
            oracle,
        };

        self.compute_units += update_ix.compute_units();
        // One more unique oracle account.
        self.loaded_account_data_size += update_ix.oracle_data_len() + ACCOUNT_METADATA;

        self.oracle_update_ixs.push(update_ix.into());

        self
    }

    /// SIMD-0186 loaded-accounts-data-size the tx will request (distinct oracles).
    #[must_use]
    pub const fn loaded_accounts_data_size(&self) -> u32 {
        self.loaded_account_data_size
    }

    #[must_use]
    pub const fn with_unit_price(mut self, micro_lamports: u64) -> Self {
        self.unit_price = Some(micro_lamports);
        self
    }

    #[must_use]
    pub fn build(self, recent_blockhash: Hash) -> Transaction {
        let mut ixs = Vec::with_capacity(self.oracle_update_ixs.len() + 3);
        let loaded_account_data_size = self.loaded_account_data_size;
        let mut compute_units = self.compute_units;

        if let Some(unit_price) = self.unit_price {
            ixs.push(ComputeBudgetInstruction::set_compute_unit_price(unit_price));
            // Reuses the ComputeBudget account, so loaded size is unchanged.
            compute_units += COMPUTE_BUDGET_IX_CU;
        }

        ixs.push(
            ComputeBudgetInstruction::set_loaded_accounts_data_size_limit(loaded_account_data_size),
        );
        ixs.push(ComputeBudgetInstruction::set_compute_unit_limit(
            compute_units,
        ));

        for oracle_ix in self.oracle_update_ixs {
            ixs.push(oracle_ix);
        }

        Transaction::new_signed_with_payer(
            &ixs,
            Some(&self.admin.pubkey()),
            &[&self.admin],
            recent_blockhash,
        )
    }
}

#[cfg(test)]
mod tests {
    use solana_keypair::Keypair;
    use solana_pubkey::Pubkey;

    use super::*;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct PriceFeed {
        pub price: u64,
    }

    #[test]
    fn single_update_is_exact_simd0186_size() {
        let admin = Keypair::new();
        let builder = Builder::new(&admin).add_oracle_update(
            Pubkey::new_unique(),
            Oracle {
                sequence: 1,
                payload: PriceFeed { price: 1 },
            },
        );

        // [0 + 22 + 36 + 1189 + 16] + 5*64 = 1583 (validator-confirmed).
        assert_eq!(builder.loaded_accounts_data_size(), 1583);
    }

    #[test]
    fn unit_price_does_not_change_loaded_size() {
        let admin = Keypair::new();
        let update = || {
            (
                Pubkey::new_unique(),
                Oracle {
                    sequence: 1,
                    payload: PriceFeed { price: 1 },
                },
            )
        };
        let (k, o) = update();
        let without = Builder::new(&admin)
            .add_oracle_update(k, o)
            .loaded_accounts_data_size();
        let (k, o) = update();
        let with = Builder::new(&admin)
            .add_oracle_update(k, o)
            .with_unit_price(1_000)
            .loaded_accounts_data_size();
        assert_eq!(without, with);
    }

    #[test]
    fn each_distinct_oracle_adds_data_len_plus_metadata() {
        let admin = Keypair::new();
        let mut builder = Builder::new(&admin);
        for price in 0..3 {
            builder = builder.add_oracle_update(
                Pubkey::new_unique(),
                Oracle {
                    sequence: 1,
                    payload: PriceFeed { price },
                },
            );
        }
        // 1583 + 2 * (16 + 64) = 1743.
        assert_eq!(builder.loaded_accounts_data_size(), 1743);
    }
}
