use std::fs;
use std::path::PathBuf;

use clap::Args;

use doppler_cli::render_init_schema_file;

#[derive(Args)]
pub struct InitArgs {
    #[arg(long, default_value = "payload.json")]
    pub out: PathBuf,
}

pub fn run(args: InitArgs) -> Result<(), anyhow::Error> {
    let schema_file = fs::canonicalize(&args.out).unwrap_or(args.out);
    if let Some(parent) = schema_file.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&schema_file, render_init_schema_file())?;
    println!("Created schema: {}", schema_file.display());
    Ok(())
}
