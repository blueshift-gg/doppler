use std::path::PathBuf;

use clap::Args;
use doppler_cli::{deploy_program, solana_config::default_solana_config_path, DeployOptions};

#[derive(Args)]
#[command(after_help = "\
If manifest.json sits next to the binary file, deploy verifies that admin and programId match.
")]
pub struct DeployArgs {
    pub binary_file: PathBuf,
    #[arg(long)]
    pub program_keypair: PathBuf,
    #[arg(long)]
    pub admin: String,
    #[arg(long)]
    pub signer: Option<PathBuf>,
    #[arg(long)]
    pub network: Option<String>,
    #[arg(long)]
    pub config: Option<PathBuf>,
}

pub fn run(args: DeployArgs) -> Result<(), anyhow::Error> {
    let result = deploy_program(DeployOptions {
        binary_path: args.binary_file,
        program_keypair_path: args.program_keypair,
        admin: args.admin,
        signer_keypair_path: args.signer,
        network: args.network,
        config_path: args.config.or(Some(default_solana_config_path())),
    })?;

    if let Some(signature) = result.signatures.last() {
        println!("Deployed program: {signature}");
    }

    Ok(())
}
