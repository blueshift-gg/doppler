use std::path::{Path, PathBuf};

use clap::Args;
use doppler_cli::{
    create_generator_config, load_generator_config_input, slugify, write_doppler_artifacts,
    ConfigOverrides, SbpfArch,
};
use solana_keypair::{write_keypair_file, Keypair};
use solana_signer::Signer;

#[derive(Args)]
#[command(after_help = "\
Does not modify the input schema file.
If programId or admin are missing from manifest.json and CLI flags, keypair files are
created under --keys-dir and their public keys are written to manifest.json.
Subsequent runs reuse programId and admin from manifest.json in the schema file directory.
")]
pub struct GenerateArgs {
    pub schema_file: PathBuf,
    #[arg(default_value = "doppler")]
    pub name: String,
    #[arg(long)]
    pub out: Option<PathBuf>,
    #[arg(long)]
    pub manifest: Option<PathBuf>,
    #[arg(long, value_parser = parse_arch)]
    pub arch: Option<SbpfArch>,
    #[arg(long)]
    pub program_id: Option<String>,
    #[arg(long)]
    pub admin: Option<String>,
    #[arg(long, default_value = "keys")]
    pub keys_dir: PathBuf,
}

#[derive(Debug, Clone)]
struct GeneratedKeypair {
    role: &'static str,
    public_key: String,
    file: PathBuf,
}

pub fn run(args: GenerateArgs) -> Result<(), anyhow::Error> {
    let loaded = load_generator_config_input(&args.schema_file)?;
    let slug = slugify(&args.name);
    let binary_file = args
        .out
        .clone()
        .unwrap_or_else(|| PathBuf::from(format!("./{slug}.so")));

    let mut generated_keypairs = Vec::new();
    let mut overrides = ConfigOverrides {
        name: Some(args.name.clone()),
        arch: args.arch,
        ..Default::default()
    };

    if let Some(program_id) = args.program_id.clone() {
        overrides.program_id = Some(program_id);
    } else if loaded.program_id.is_none() {
        let address = generate_keypair("program", &slug, &args.keys_dir, &mut generated_keypairs)?;
        overrides.program_id = Some(address);
    }

    if let Some(admin) = args.admin.clone() {
        overrides.admin = Some(admin);
    } else if loaded.admin.is_none() {
        let address = generate_keypair("admin", &slug, &args.keys_dir, &mut generated_keypairs)?;
        overrides.admin = Some(address);
    }

    let config = create_generator_config(loaded, overrides)?;
    let manifest = write_doppler_artifacts(&config, &binary_file, args.manifest.as_deref())?;

    println!(
        "Generated {} ({}, {} byte payload)",
        manifest.name, manifest.arch, manifest.payload_size
    );
    println!("Compiled binary: {}", binary_file.display());
    if let Some(manifest_file) = args.manifest {
        println!("Manifest: {}", manifest_file.display());
    }

    for keypair in &generated_keypairs {
        println!(
            "Generated {} keypair: {} ({})",
            keypair.role,
            keypair.file.display(),
            keypair.public_key
        );
    }

    Ok(())
}

fn generate_keypair(
    role: &'static str,
    slug: &str,
    keys_dir: &Path,
    generated_keypairs: &mut Vec<GeneratedKeypair>,
) -> Result<String, anyhow::Error> {
    std::fs::create_dir_all(keys_dir)?;
    let keypair = Keypair::new();
    let file = keys_dir.join(format!("{slug}-{role}-keypair.json"));
    let _ = write_keypair_file(&keypair, &file).map_err(|error| anyhow::anyhow!("{error}"))?;
    let public_key = keypair.pubkey().to_string();
    generated_keypairs.push(GeneratedKeypair {
        role,
        public_key: public_key.clone(),
        file,
    });
    Ok(public_key)
}

fn parse_arch(value: &str) -> Result<SbpfArch, String> {
    SbpfArch::parse(value).ok_or_else(|| format!("expected one of: v0, v3"))
}
