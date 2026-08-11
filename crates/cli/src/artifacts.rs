use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::assemble::generate_binary;
use crate::config::GeneratorConfig;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedManifest {
    pub name: String,
    pub program_id: String,
    pub admin: String,
    pub arch: String,
    pub payload_size: u32,
    pub schema_hash: String,
    pub elf_sha256: String,
}

#[derive(Debug, Clone)]
pub struct DopplerArtifacts {
    pub binary: Vec<u8>,
    pub manifest: GeneratedManifest,
}

pub fn create_doppler_artifacts(
    config: &GeneratorConfig,
) -> Result<DopplerArtifacts, crate::assemble::AssembleError> {
    let binary = generate_binary(&config.admin, config.layout.payload_size, config.arch)?;

    let schema_json =
        serde_json::to_string(&config.layout.fields).expect("layout fields serialize");
    let manifest = GeneratedManifest {
        name: config.name.clone(),
        program_id: config.program_id.clone(),
        admin: config.admin.clone(),
        arch: config.arch.as_str().to_string(),
        payload_size: config.layout.payload_size,
        schema_hash: format!("sha256:{}", sha256_hex(schema_json.as_bytes())),
        elf_sha256: format!("sha256:{}", sha256_hex(&binary)),
    };

    Ok(DopplerArtifacts { binary, manifest })
}

pub fn write_doppler_artifacts(
    config: &GeneratorConfig,
    binary_file: impl AsRef<Path>,
    manifest_file: Option<&Path>,
) -> Result<GeneratedManifest, ArtifactError> {
    let artifacts = create_doppler_artifacts(config)?;
    write_file_ensuring_dir(binary_file.as_ref(), &artifacts.binary)?;

    let manifest_path = manifest_file.map(PathBuf::from).unwrap_or_else(|| {
        binary_file
            .as_ref()
            .parent()
            .map(|dir| dir.join("manifest.json"))
            .unwrap_or_else(|| PathBuf::from("manifest.json"))
    });

    let manifest_json = serde_json::to_string_pretty(&artifacts.manifest)? + "\n";
    write_file_ensuring_dir(&manifest_path, manifest_json.as_bytes())?;

    Ok(artifacts.manifest)
}

#[derive(Debug, thiserror::Error)]
pub enum ArtifactError {
    #[error("{0}")]
    Assemble(#[from] crate::assemble::AssembleError),
    #[error("Failed to write artifact: {0}")]
    Io(#[from] std::io::Error),
    #[error("Failed to serialize manifest: {0}")]
    Json(#[from] serde_json::Error),
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn write_file_ensuring_dir(path: &Path, content: &[u8]) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, content)
}
