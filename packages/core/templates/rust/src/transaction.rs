use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_hash::Hash;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer as _;
use solana_transaction::Transaction;

use crate::accounts::{Oracle, UpdateInstruction};
use crate::constants::{
    COMPUTE_BUDGET_DATA_LIMIT_SIZE, COMPUTE_BUDGET_IX_CU, COMPUTE_BUDGET_PROGRAM_SIZE,
    COMPUTE_BUDGET_UNIT_LIMIT_SIZE, COMPUTE_BUDGET_UNIT_PRICE_SIZE, ORACLE_PROGRAM_SIZE,
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
            loaded_account_data_size: ORACLE_PROGRAM_SIZE
                + COMPUTE_BUDGET_PROGRAM_SIZE
                + COMPUTE_BUDGET_UNIT_LIMIT_SIZE
                + COMPUTE_BUDGET_DATA_LIMIT_SIZE
                + 2,
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
        self.loaded_account_data_size += update_ix.loaded_accounts_data_size_limit() * 2;

        self.oracle_update_ixs.push(update_ix.into());

        self
    }

    #[must_use]
    pub const fn with_unit_price(mut self, micro_lamports: u64) -> Self {
        self.unit_price = Some(micro_lamports);
        self
    }

    #[must_use]
    pub fn build(self, recent_blockhash: Hash) -> Transaction {
        let mut ixs = Vec::with_capacity(self.oracle_update_ixs.len() + 3);
        let mut loaded_account_data_size = self.loaded_account_data_size;
        let mut compute_units = self.compute_units;

        if let Some(unit_price) = self.unit_price {
            ixs.push(ComputeBudgetInstruction::set_compute_unit_price(unit_price));
            loaded_account_data_size += COMPUTE_BUDGET_UNIT_PRICE_SIZE;
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
