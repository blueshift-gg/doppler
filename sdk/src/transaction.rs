use solana_client::rpc_client;
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_hash::Hash;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_pubkey::{Pubkey, PubkeyError};
use solana_sdk_ids::bpf_loader_upgradeable;
use solana_signer::Signer as _;
use solana_system_interface::instruction::create_account_with_seed;
use solana_transaction::Transaction;

use crate::accounts::{Oracle, UpdateInstruction};
use crate::constants::{
    ACCOUNT_METADATA_SIZE, COMPUTE_BUDGET_IX_CU, COMPUTE_BUDGET_PROGRAM_SIZE,
    COMPUTE_BUDGET_UNIT_PRICE_SIZE, ELF_HEADER_SIZE, PROGRAM_ACCOUNT_SIZE,
};

fn oracle_pubkey(admin: &Pubkey, seed: &str, program_id: &Pubkey) -> Result<Pubkey, PubkeyError> {
    Pubkey::create_with_seed(admin, seed, program_id)
}

fn derive_program_data_address(program_address: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[program_address.to_bytes().as_slice()],
        &bpf_loader_upgradeable::id(),
    )
    .0
}

pub struct Builder<'a> {
    oracle_update_ixs: Vec<Instruction>,
    rpc_client: &'a rpc_client::RpcClient,
    program_id: Pubkey,
    admin: &'a Keypair,
    unit_price: Option<u64>,
    compute_units: u32,
    loaded_account_data_size: u32,
}

impl<'a> Builder<'a> {
    #[must_use]
    pub fn new(
        rpc_client: &'a rpc_client::RpcClient,
        program_id: Pubkey,
        admin: &'a Keypair,
    ) -> Self {
        let program_data_address = derive_program_data_address(&program_id);
        let program_data_account_size = rpc_client
            .get_account_data(&program_data_address)
            .unwrap()
            .len();

        Self {
            rpc_client,
            program_id,
            admin,
            oracle_update_ixs: vec![],
            unit_price: None,
            compute_units: COMPUTE_BUDGET_IX_CU * 2, // default 2 compute budget ixs
            loaded_account_data_size: PROGRAM_ACCOUNT_SIZE
                + COMPUTE_BUDGET_PROGRAM_SIZE
                + ELF_HEADER_SIZE as u32
                + program_data_account_size as u32
                + (ACCOUNT_METADATA_SIZE as u32 * 4),
        }
    }

    pub fn add_oracle_update<T: Sized + Copy>(
        mut self,
        oracle_pubkey: Pubkey,
        oracle: Oracle<T>,
    ) -> Self {
        let update_ix = UpdateInstruction {
            program_id: self.program_id,
            admin: self.admin.pubkey(),
            oracle_pubkey,
            oracle,
        };

        self.compute_units += update_ix.compute_units();
        self.loaded_account_data_size += update_ix.loaded_accounts_data_size_limit();

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

pub fn create_oracle_account<T: Sized + Copy>(
    rpc_client: &rpc_client::RpcClient,
    program_id: &Pubkey,
    admin: &Pubkey,
    seed: &str,
    oracle: Oracle<T>,
) -> Instruction {
    let space = oracle.space();
    let lamports = rpc_client
        .get_minimum_balance_for_rent_exemption(space)
        .unwrap();
    let oracle_pubkey = oracle_pubkey(admin, seed, program_id).unwrap();

    create_account_with_seed(
        admin,
        &oracle_pubkey,
        admin,
        seed,
        lamports,
        space as u64,
        program_id,
    )
}
