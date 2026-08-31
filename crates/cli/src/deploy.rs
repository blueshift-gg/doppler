use std::fs;
use std::path::{Path, PathBuf};

use solana_client::rpc_client::RpcClient;
use solana_commitment_config::CommitmentConfig;
use solana_hash::Hash;
use solana_instruction::Instruction;
use solana_keypair::{read_keypair_file, Keypair};
use solana_loader_v3_interface::{
    instruction::{create_buffer, deploy_with_max_program_len, write},
    state::UpgradeableLoaderState,
};
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_pubkey::Pubkey as Address;
use solana_signer::Signer;
use solana_transaction::Transaction;
use thiserror::Error;

use crate::solana_config::{load_solana_cli_config, SolanaConfigError};

const PACKET_DATA_SIZE: usize = 1232;
const SIGNATURE_LENGTH_IN_BYTES: usize = 64;

pub struct BuildDeployTransactionsInput<'a> {
    pub blockhash: Hash,
    pub buffer_rent: u64,
    pub program_rent: u64,
    pub payer: Pubkey,
    pub program_id: Pubkey,
    pub upgrade_authority: Pubkey,
    pub max_data_len: Option<usize>,
    pub binary: &'a [u8],
    pub buffer_keypair: Keypair,
}

pub struct DeployTransactionBundle {
    pub transactions: Vec<Transaction>,
    pub buffer_keypair: Keypair,
    pub program_id: String,
    pub max_data_len: usize,
}

pub fn build_deploy_transactions(
    input: BuildDeployTransactionsInput<'_>,
) -> Result<DeployTransactionBundle, DeployError> {
    let max_data_len = input
        .max_data_len
        .unwrap_or_else(|| input.binary.len().max(input.binary.len() * 2));
    let write_chunk_size = calculate_max_write_chunk_size(
        &input.buffer_keypair.pubkey(),
        &input.upgrade_authority,
        &input.payer,
        input.blockhash,
    )?;

    let buffer_instructions = create_buffer(
        &input.payer,
        &input.buffer_keypair.pubkey(),
        &input.upgrade_authority,
        input.buffer_rent,
        input.binary.len(),
    )
    .map_err(|error| DeployError::Instruction(error.to_string()))?;

    let mut buffer_init =
        build_transaction(&buffer_instructions, Some(&input.payer), input.blockhash)?;
    buffer_init.partial_sign(&[&input.buffer_keypair], input.blockhash);

    let mut transactions = vec![buffer_init];

    let mut offset = 0usize;
    while offset < input.binary.len() {
        let end = (offset + write_chunk_size).min(input.binary.len());
        let chunk = input.binary[offset..end].to_vec();
        let write_ix = write(
            &input.buffer_keypair.pubkey(),
            &input.upgrade_authority,
            offset as u32,
            chunk,
        );
        transactions.push(build_transaction(
            &[write_ix],
            Some(&input.payer),
            input.blockhash,
        )?);
        offset = end;
    }

    let deploy_instructions = deploy_with_max_program_len(
        &input.payer,
        &input.program_id,
        &input.buffer_keypair.pubkey(),
        &input.upgrade_authority,
        input.program_rent,
        max_data_len,
    )
    .map_err(|error| DeployError::Instruction(error.to_string()))?;

    transactions.push(build_transaction(
        &deploy_instructions,
        Some(&input.payer),
        input.blockhash,
    )?);

    Ok(DeployTransactionBundle {
        transactions,
        buffer_keypair: input.buffer_keypair,
        program_id: input.program_id.to_string(),
        max_data_len,
    })
}

fn build_transaction(
    instructions: &[Instruction],
    payer: Option<&Pubkey>,
    blockhash: Hash,
) -> Result<Transaction, DeployError> {
    let message = Message::new_with_blockhash(instructions, payer, &blockhash);
    Ok(Transaction::new_unsigned(message))
}

fn calculate_max_write_chunk_size(
    buffer_account: &Pubkey,
    upgrade_authority: &Pubkey,
    fee_payer: &Pubkey,
    blockhash: Hash,
) -> Result<usize, DeployError> {
    let write_ix = write(buffer_account, upgrade_authority, 0, Vec::new());
    let message = Message::new_with_blockhash(&[write_ix], Some(fee_payer), &blockhash);
    let tx = Transaction::new_unsigned(message);
    let message_bytes = tx.message_data();
    let num_signers = tx.message().header.num_required_signatures as usize;
    let tx_size = message_bytes.len() + num_signers * SIGNATURE_LENGTH_IN_BYTES;
    Ok(PACKET_DATA_SIZE.saturating_sub(tx_size + 1))
}

pub struct DeployOptions {
    pub binary_path: PathBuf,
    pub program_keypair_path: PathBuf,
    pub admin: String,
    pub signer_keypair_path: Option<PathBuf>,
    pub network: Option<String>,
    pub config_path: Option<PathBuf>,
}

pub struct DeployResult {
    pub signatures: Vec<String>,
}

#[derive(Debug, Error)]
pub enum KeypairError {
    #[error("Invalid keypair file: {0}")]
    Invalid(String),
}

#[derive(Debug, Error)]
pub enum DeployError {
    #[error("{label} not found: {path}")]
    FileNotFound { label: &'static str, path: PathBuf },
    #[error("Admin '{admin}' does not match manifest admin '{manifest_admin}' ({manifest_path})")]
    AdminMismatch {
        admin: String,
        manifest_admin: String,
        manifest_path: PathBuf,
    },
    #[error("Program ID '{program_id}' does not match manifest programId '{manifest_program_id}' ({manifest_path})")]
    ProgramIdMismatch {
        program_id: String,
        manifest_program_id: String,
        manifest_path: PathBuf,
    },
    #[error("{0}")]
    Keypair(#[from] KeypairError),
    #[error("{0}")]
    SolanaConfig(#[from] SolanaConfigError),
    #[error("Loader instruction error: {0}")]
    Instruction(String),
    #[error("RPC error: {0}")]
    Rpc(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

pub fn deploy_program(options: DeployOptions) -> Result<DeployResult, DeployError> {
    let _ = Address::from_str_const(&options.admin);

    assert_file_exists(&options.binary_path, "Binary file")?;
    assert_file_exists(&options.program_keypair_path, "Program keypair file")?;

    let config_path = options
        .config_path
        .clone()
        .unwrap_or_else(crate::solana_config::default_solana_config_path);
    let solana_config = load_solana_cli_config(&config_path)?;
    let signer_keypair_path = options
        .signer_keypair_path
        .clone()
        .unwrap_or_else(|| PathBuf::from(&solana_config.keypair_path));
    let network = options
        .network
        .clone()
        .unwrap_or(solana_config.json_rpc_url);

    assert_file_exists(&signer_keypair_path, "Signer keypair file")?;

    let binary = fs::read(&options.binary_path)?;
    let program_keypair = read_keypair(&options.program_keypair_path)?;
    let signer_keypair = read_keypair(&signer_keypair_path)?;

    let program_id = program_keypair.pubkey().to_string();
    validate_manifest(&options.binary_path, &options.admin, &program_id)?;

    let client = RpcClient::new_with_commitment(network, CommitmentConfig::confirmed());
    let blockhash = client
        .get_latest_blockhash()
        .map_err(|error| DeployError::Rpc(error.to_string()))?;
    let buffer_rent = client
        .get_minimum_balance_for_rent_exemption(UpgradeableLoaderState::size_of_buffer(
            binary.len(),
        ))
        .map_err(|error| DeployError::Rpc(error.to_string()))?;
    let program_rent = client
        .get_minimum_balance_for_rent_exemption(UpgradeableLoaderState::size_of_program())
        .map_err(|error| DeployError::Rpc(error.to_string()))?;

    let buffer_keypair = Keypair::new();
    let bundle = build_deploy_transactions(BuildDeployTransactionsInput {
        blockhash,
        buffer_rent,
        program_rent,
        payer: signer_keypair.pubkey(),
        program_id: program_keypair.pubkey(),
        upgrade_authority: signer_keypair.pubkey(),
        max_data_len: None,
        binary: &binary,
        buffer_keypair,
    })?;

    let signatures = send_deploy_transactions(
        &client,
        bundle.transactions,
        &signer_keypair,
        &program_keypair,
        blockhash,
    )?;

    Ok(DeployResult { signatures })
}

fn read_keypair(path: &Path) -> Result<Keypair, DeployError> {
    read_keypair_file(path).map_err(|error| {
        DeployError::Keypair(KeypairError::Invalid(format!(
            "{}: {error}",
            path.display()
        )))
    })
}

fn assert_file_exists(path: &Path, label: &'static str) -> Result<(), DeployError> {
    if path.exists() {
        Ok(())
    } else {
        Err(DeployError::FileNotFound {
            label,
            path: path.to_path_buf(),
        })
    }
}

fn validate_manifest(binary_path: &Path, admin: &str, program_id: &str) -> Result<(), DeployError> {
    let manifest_path = binary_path
        .parent()
        .map(|dir| dir.join("manifest.json"))
        .unwrap_or_else(|| PathBuf::from("manifest.json"));

    if !manifest_path.exists() {
        return Ok(());
    }

    let manifest: serde_json::Value = serde_json::from_slice(&fs::read(&manifest_path)?)?;
    if let Some(manifest_admin) = manifest.get("admin").and_then(|value| value.as_str()) {
        if manifest_admin != admin {
            return Err(DeployError::AdminMismatch {
                admin: admin.to_string(),
                manifest_admin: manifest_admin.to_string(),
                manifest_path,
            });
        }
    }
    if let Some(manifest_program_id) = manifest.get("programId").and_then(|value| value.as_str()) {
        if manifest_program_id != program_id {
            return Err(DeployError::ProgramIdMismatch {
                program_id: program_id.to_string(),
                manifest_program_id: manifest_program_id.to_string(),
                manifest_path,
            });
        }
    }

    Ok(())
}

fn send_deploy_transactions(
    client: &RpcClient,
    mut transactions: Vec<Transaction>,
    signer_keypair: &Keypair,
    program_keypair: &Keypair,
    blockhash: Hash,
) -> Result<Vec<String>, DeployError> {
    let mut signatures = Vec::with_capacity(transactions.len());
    let transaction_count = transactions.len();

    for (index, transaction) in transactions.iter_mut().enumerate() {
        if index + 1 == transaction_count {
            transaction
                .try_partial_sign(&[signer_keypair, program_keypair], blockhash)
                .map_err(|error| DeployError::Rpc(error.to_string()))?;
        } else {
            transaction
                .try_partial_sign(&[signer_keypair], blockhash)
                .map_err(|error| DeployError::Rpc(error.to_string()))?;
        }

        let signature = client
            .send_and_confirm_transaction(transaction)
            .map_err(|error| DeployError::Rpc(error.to_string()))?;
        signatures.push(signature.to_string());
    }

    Ok(signatures)
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_keypair::Keypair;
    use solana_signer::Signer;
    use tempfile::TempDir;

    #[test]
    fn builds_loader_v3_transaction_chain() {
        let payer = Keypair::new();
        let program = Keypair::new();
        let binary = vec![0x7f, 0x45, 0x4c, 0x46, 0x01, 0x02, 0x03];
        let blockhash = Hash::new_unique();

        let bundle = build_deploy_transactions(BuildDeployTransactionsInput {
            blockhash,
            buffer_rent: 1_000,
            program_rent: 500,
            payer: payer.pubkey(),
            program_id: program.pubkey(),
            upgrade_authority: payer.pubkey(),
            max_data_len: None,
            binary: &binary,
            buffer_keypair: Keypair::new(),
        })
        .unwrap();

        assert!(bundle.transactions.len() >= 3);
        assert!(bundle.max_data_len >= binary.len());
    }

    #[test]
    fn rejects_admin_manifest_mismatch() {
        let dir = TempDir::new().unwrap();
        let binary_path = dir.path().join("price-feed.so");
        fs::write(&binary_path, [0x7f, 0x45, 0x4c, 0x46]).unwrap();
        fs::write(
            dir.path().join("manifest.json"),
            r#"{"programId":"11111111111111111111111111111111","admin":"admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE"}"#,
        )
        .unwrap();

        let err = validate_manifest(
            &binary_path,
            "11111111111111111111111111111111",
            "11111111111111111111111111111111",
        )
        .unwrap_err();

        assert!(matches!(err, DeployError::AdminMismatch { .. }));
    }
}
