use futures::future::BoxFuture;
use futures::{future::ready, Stream, StreamExt};
use solana_client::nonblocking::pubsub_client::{PubsubClient, PubsubClientError};
use solana_client::rpc_client;
use solana_client::rpc_config::RpcAccountInfoConfig;
use solana_commitment_config::CommitmentConfig;
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_hash::Hash;
use solana_instruction::Instruction;
use solana_message::Message;
use solana_pubkey::{Pubkey, PubkeyError};
use solana_sdk_ids::bpf_loader_upgradeable;
use solana_system_interface::instruction::create_account_with_seed;
use solana_transaction::Transaction;

use crate::accounts::{Oracle, UpdateInstruction};
use crate::constants::{
    ACCOUNT_METADATA_SIZE, COMPUTE_BUDGET_IX_CU, COMPUTE_BUDGET_PROGRAM_SIZE, ELF_HEADER_SIZE,
    PROGRAM_ACCOUNT_SIZE,
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

fn get_average_priority_fee(
    rpc_client: &rpc_client::RpcClient,
    mutable_accounts: &[Pubkey],
) -> u64 {
    let fees = rpc_client
        .get_recent_prioritization_fees(mutable_accounts)
        .unwrap();
    fees.iter().map(|fee| fee.prioritization_fee).sum::<u64>() / fees.len() as u64
}

pub struct Builder<'a> {
    oracle_update_ixs: Vec<Instruction>,
    rpc_client: &'a rpc_client::RpcClient,
    program_id: Pubkey,
    admin: Pubkey,
    unit_price: Option<u64>,
    compute_units: u32,
    loaded_account_data_size: u32,
}

impl<'a> Builder<'a> {
    #[must_use]
    pub fn new(rpc_client: &'a rpc_client::RpcClient, program_id: Pubkey, admin: Pubkey) -> Self {
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
            compute_units: COMPUTE_BUDGET_IX_CU * 3, // default 3 compute budget ixs
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
            admin: self.admin,
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
        // 3 compute budget ixs
        let mut ixs = Vec::with_capacity(self.oracle_update_ixs.len() + 3);
        let loaded_account_data_size = self.loaded_account_data_size;
        let compute_units = self.compute_units;

        let micro_lamports = match self.unit_price {
            Some(unit_price) => unit_price,
            None => {
                // the 2nd account in each oracle_update_ix is the mutable oracle account
                let mutable_accounts = self
                    .oracle_update_ixs
                    .iter()
                    .map(|ix| ix.accounts[1].pubkey)
                    .collect::<Vec<Pubkey>>();
                get_average_priority_fee(self.rpc_client, &mutable_accounts)
            }
        };

        ixs.push(ComputeBudgetInstruction::set_compute_unit_price(
            micro_lamports,
        ));

        ixs.push(
            ComputeBudgetInstruction::set_loaded_accounts_data_size_limit(loaded_account_data_size),
        );
        ixs.push(ComputeBudgetInstruction::set_compute_unit_limit(
            compute_units,
        ));

        for oracle_ix in self.oracle_update_ixs {
            ixs.push(oracle_ix);
        }

        let message = Message::new_with_blockhash(&ixs, Some(&self.admin), &recent_blockhash);
        Transaction::new_unsigned(message)
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

pub fn fetch_oracle<T: Sized + Copy>(
    rpc_client: &rpc_client::RpcClient,
    oracle_pubkey: &Pubkey,
) -> Oracle<T> {
    let data = rpc_client.get_account_data(oracle_pubkey).unwrap();
    Oracle::<T>::from_bytes(data.as_slice())
}

pub async fn subscribe_to_oracle<'a, T: Sized + Copy + 'a>(
    pubsub_client: &'a PubsubClient,
    oracle_pubkey: &Pubkey,
) -> Result<
    (
        impl Stream<Item = Oracle<T>> + 'a,
        Box<dyn FnOnce() -> BoxFuture<'static, ()> + Send>,
    ),
    PubsubClientError,
> {
    let config = RpcAccountInfoConfig {
        commitment: Some(CommitmentConfig::confirmed()),
        encoding: None,
        data_slice: None,
        min_context_slot: None,
    };

    let (notifications, unsubscribe) = pubsub_client
        .account_subscribe(oracle_pubkey, Some(config))
        .await?;

    let oracle_notifications = notifications.filter_map(|response| {
        let data = match response.value.data.decode() {
            Some(data) => data,
            None => return ready(None),
        };
        ready(Some(Oracle::<T>::from_bytes(&data)))
    });

    Ok((oracle_notifications, unsubscribe))
}
