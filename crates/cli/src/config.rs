use std::fs;
use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use serde::Deserialize;
use thiserror::Error;

use crate::layout::{compute_payload_layout, PayloadLayout};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SbpfArch {
    #[serde(rename = "v0")]
    V0,
    #[serde(rename = "v3")]
    V3,
}

impl SbpfArch {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::V0 => "v0",
            Self::V3 => "v3",
        }
    }

    pub fn assembler_version(self) -> u32 {
        match self {
            Self::V0 => 0,
            Self::V3 => 3,
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "v0" => Some(Self::V0),
            "v3" => Some(Self::V3),
            _ => None,
        }
    }
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorConfigInput {
    pub name: Option<String>,
    pub program_id: Option<String>,
    pub admin: Option<String>,
    pub arch: Option<SbpfArch>,
    pub payload: Option<IndexMap<String, serde_json::Value>>,
}

#[derive(Debug, Default, Clone)]
pub struct ConfigOverrides {
    pub name: Option<String>,
    pub program_id: Option<String>,
    pub admin: Option<String>,
    pub arch: Option<SbpfArch>,
}

#[derive(Debug, Clone)]
pub struct GeneratorConfig {
    pub name: String,
    pub package_name: String,
    pub program_id: String,
    pub admin: String,
    pub arch: SbpfArch,
    pub layout: PayloadLayout,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("Generator config requires a payload schema")]
    MissingPayload,
    #[error("Generator config requires a name")]
    MissingName,
    #[error("Generator config requires a programId")]
    MissingProgramId,
    #[error("Generator config requires an admin address")]
    MissingAdmin,
    #[error("Invalid arch '{0}'. Expected one of: v0, v3")]
    InvalidArch(String),
    #[error("Unsupported schema file extension '{0}'")]
    UnsupportedExtension(String),
    #[error("Config file '{0}' must export a payload object")]
    MissingPayloadInFile(String),
    #[error("{0}")]
    Schema(#[from] crate::schema::SchemaError),
    #[error("Failed to read {path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("Failed to parse JSON in {path}: {source}")]
    Json {
        path: PathBuf,
        source: serde_json::Error,
    },
}

pub fn create_generator_config(
    loaded: GeneratorConfigInput,
    overrides: ConfigOverrides,
) -> Result<GeneratorConfig, ConfigError> {
    let mut input = loaded;
    if let Some(name) = overrides.name {
        input.name = Some(name);
    }
    if let Some(program_id) = overrides.program_id {
        input.program_id = Some(program_id);
    }
    if let Some(admin) = overrides.admin {
        input.admin = Some(admin);
    }
    if let Some(arch) = overrides.arch {
        input.arch = Some(arch);
    }

    let payload = input.payload.ok_or(ConfigError::MissingPayload)?;

    let name = input
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(ConfigError::MissingName)?
        .to_string();

    let program_id = input
        .program_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(ConfigError::MissingProgramId)?
        .to_string();

    let admin = input
        .admin
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(ConfigError::MissingAdmin)?
        .to_string();

    let arch = input.arch.unwrap_or(SbpfArch::V3);

    let payload_map: IndexMap<String, serde_json::Value> = payload;
    let layout = compute_payload_layout(&payload_map)?;

    Ok(GeneratorConfig {
        name: name.clone(),
        package_name: normalize_package_name(&name),
        program_id,
        admin,
        arch,
        layout,
    })
}

pub fn load_generator_config_input(
    path: impl AsRef<Path>,
) -> Result<GeneratorConfigInput, ConfigError> {
    let absolute_path = fs::canonicalize(path.as_ref()).map_err(|source| ConfigError::Io {
        path: path.as_ref().to_path_buf(),
        source,
    })?;
    let schema_input = load_schema_file_input(&absolute_path)?;
    let manifest_input = load_manifest_config_input(absolute_path.parent());
    Ok(merge_config_input(manifest_input, schema_input))
}

pub fn load_generator_config(
    path: impl AsRef<Path>,
    overrides: ConfigOverrides,
) -> Result<GeneratorConfig, ConfigError> {
    let loaded = load_generator_config_input(path)?;
    create_generator_config(loaded, overrides)
}

fn merge_config_input(
    manifest: GeneratorConfigInput,
    schema: GeneratorConfigInput,
) -> GeneratorConfigInput {
    GeneratorConfigInput {
        name: schema.name.or(manifest.name),
        program_id: schema.program_id.or(manifest.program_id),
        admin: schema.admin.or(manifest.admin),
        arch: schema.arch.or(manifest.arch),
        payload: schema.payload.or(manifest.payload),
    }
}

fn load_schema_file_input(path: &Path) -> Result<GeneratorConfigInput, ConfigError> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if extension != "json" {
        return Err(ConfigError::UnsupportedExtension(format!(".{extension}")));
    }

    let content = fs::read_to_string(path).map_err(|source| ConfigError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let raw: serde_json::Value =
        serde_json::from_str(&content).map_err(|source| ConfigError::Json {
            path: path.to_path_buf(),
            source,
        })?;

    parse_config_value(raw, path)
}

fn parse_config_value(
    value: serde_json::Value,
    path: &Path,
) -> Result<GeneratorConfigInput, ConfigError> {
    let object = value
        .as_object()
        .ok_or_else(|| ConfigError::MissingPayloadInFile(path.display().to_string()))?;

    let payload = object
        .get("payload")
        .and_then(|value| value.as_object())
        .map(|payload| {
            payload
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect::<IndexMap<_, _>>()
        });

    if payload.is_none() && !object.contains_key("payload") {
        // Entire file may be payload-only shorthand — not supported; require an explicit payload key.
    }

    let payload =
        payload.ok_or_else(|| ConfigError::MissingPayloadInFile(path.display().to_string()))?;

    Ok(GeneratorConfigInput {
        name: object
            .get("name")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        program_id: object
            .get("programId")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        admin: object
            .get("admin")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        arch: object
            .get("arch")
            .and_then(|v| v.as_str())
            .and_then(SbpfArch::parse),
        payload: Some(payload),
    })
}

fn load_manifest_config_input(directory: Option<&Path>) -> GeneratorConfigInput {
    let Some(directory) = directory else {
        return GeneratorConfigInput::default();
    };

    let manifest_path = directory.join("manifest.json");
    let Ok(content) = fs::read_to_string(&manifest_path) else {
        return GeneratorConfigInput::default();
    };
    let Ok(raw) = serde_json::from_str::<serde_json::Value>(&content) else {
        return GeneratorConfigInput::default();
    };
    let Some(object) = raw.as_object() else {
        return GeneratorConfigInput::default();
    };

    GeneratorConfigInput {
        name: object
            .get("name")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        program_id: object
            .get("programId")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        admin: object
            .get("admin")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        arch: object
            .get("arch")
            .and_then(|v| v.as_str())
            .and_then(SbpfArch::parse),
        payload: None,
    }
}

pub fn normalize_package_name(name: &str) -> String {
    let mut slug = String::new();
    let chars: Vec<char> = name.trim().chars().collect();
    for (index, ch) in chars.iter().enumerate() {
        if index > 0 {
            let prev = chars[index - 1];
            if prev.is_ascii_lowercase() && ch.is_ascii_uppercase() {
                slug.push('-');
            }
        }
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
        } else {
            slug.push('-');
        }
    }
    while slug.starts_with('-') {
        slug.remove(0);
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "doppler".into()
    } else {
        slug
    }
}

pub fn slugify(value: &str) -> String {
    normalize_package_name(value)
}

pub fn render_init_schema_file() -> String {
    r#"{
  "payload": {
    "price": "u64"
  }
}
"#
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use indexmap::IndexMap;
    use tempfile::TempDir;

    #[test]
    fn creates_config_from_input() {
        let mut payload = IndexMap::new();
        payload.insert("price".into(), serde_json::json!("u64"));
        let config = create_generator_config(
            GeneratorConfigInput {
                name: Some("sol-usdc-feed".into()),
                program_id: Some("fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm".into()),
                admin: Some("admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE".into()),
                arch: None,
                payload: Some(payload),
            },
            ConfigOverrides::default(),
        )
        .unwrap();

        assert_eq!(config.arch, SbpfArch::V3);
        assert_eq!(config.package_name, "sol-usdc-feed");
        assert_eq!(config.layout.payload_size, 8);
    }

    #[test]
    fn loads_manifest_metadata() {
        let dir = TempDir::new().unwrap();
        let schema_path = dir.path().join("payload.json");
        fs::write(&schema_path, r#"{"payload":{"price":"u64"}}"#).unwrap();
        fs::write(
            dir.path().join("manifest.json"),
            r#"{"name":"sol-usdc-feed","programId":"fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm","admin":"admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE"}"#,
        )
        .unwrap();

        let config = load_generator_config(&schema_path, ConfigOverrides::default()).unwrap();
        assert_eq!(config.name, "sol-usdc-feed");
        assert_eq!(
            config.program_id,
            "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm"
        );
    }

    #[test]
    fn applies_overrides() {
        let mut payload = IndexMap::new();
        payload.insert("price".into(), serde_json::json!("u64"));
        let config = create_generator_config(
            GeneratorConfigInput {
                payload: Some(payload),
                ..Default::default()
            },
            ConfigOverrides {
                name: Some("OverrideFeed".into()),
                program_id: Some("fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm".into()),
                admin: Some("admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE".into()),
                arch: Some(SbpfArch::V0),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(config.name, "OverrideFeed");
        assert_eq!(config.package_name, "override-feed");
        assert_eq!(config.arch, SbpfArch::V0);
    }
}
