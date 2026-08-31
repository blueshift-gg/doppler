use std::path::{Path, PathBuf};

use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SolanaCliConfig {
    pub keypair_path: String,
    pub json_rpc_url: String,
}

pub fn default_solana_config_path() -> PathBuf {
    dirs_home().join(".config/solana/cli/config.yml")
}

fn dirs_home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn parse_solana_cli_config(content: &str) -> PartialSolanaCliConfig {
    let mut result = PartialSolanaCliConfig::default();
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("keypair_path:") {
            result.keypair_path = Some(value.trim().to_string());
        } else if let Some(value) = trimmed.strip_prefix("json_rpc_url:") {
            result.json_rpc_url = Some(value.trim().to_string());
        }
    }
    result
}

#[derive(Debug, Default)]
pub struct PartialSolanaCliConfig {
    pub keypair_path: Option<String>,
    pub json_rpc_url: Option<String>,
}

#[derive(Debug, Error)]
pub enum SolanaConfigError {
    #[error("Missing keypair_path in Solana CLI config: {0}")]
    MissingKeypairPath(PathBuf),
    #[error("Missing json_rpc_url in Solana CLI config: {0}")]
    MissingJsonRpcUrl(PathBuf),
    #[error("Failed to read Solana CLI config {path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
}

pub fn expand_home_path(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        dirs_home().join(rest)
    } else {
        PathBuf::from(path)
    }
}

pub fn load_solana_cli_config(
    path: impl AsRef<Path>,
) -> Result<SolanaCliConfig, SolanaConfigError> {
    let path = path.as_ref().to_path_buf();
    let content = std::fs::read_to_string(&path).map_err(|source| SolanaConfigError::Io {
        path: path.clone(),
        source,
    })?;
    let parsed = parse_solana_cli_config(&content);

    let keypair_path = parsed
        .keypair_path
        .ok_or_else(|| SolanaConfigError::MissingKeypairPath(path.clone()))?;
    let json_rpc_url = parsed
        .json_rpc_url
        .ok_or_else(|| SolanaConfigError::MissingJsonRpcUrl(path.clone()))?;

    Ok(SolanaCliConfig {
        keypair_path: expand_home_path(&keypair_path).display().to_string(),
        json_rpc_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn parse_reads_key_fields() {
        let parsed = parse_solana_cli_config(
            "json_rpc_url: https://api.devnet.solana.com\nkeypair_path: ~/my-wallet.json\n",
        );
        assert_eq!(
            parsed.json_rpc_url.as_deref(),
            Some("https://api.devnet.solana.com")
        );
        assert_eq!(parsed.keypair_path.as_deref(), Some("~/my-wallet.json"));
    }

    #[test]
    fn expand_home_path_resolves_tilde() {
        let expanded = expand_home_path("~/wallet.json");
        assert!(expanded.ends_with("wallet.json"));
    }

    #[test]
    fn load_expands_config_values() {
        let dir = TempDir::new().unwrap();
        let config_path = dir.path().join("config.yml");
        std::fs::write(
            &config_path,
            "json_rpc_url: https://rpc.example.com\nkeypair_path: ~/signer.json\n",
        )
        .unwrap();

        let config = load_solana_cli_config(&config_path).unwrap();
        assert_eq!(config.json_rpc_url, "https://rpc.example.com");
        assert!(config.keypair_path.ends_with("signer.json"));
    }
}
