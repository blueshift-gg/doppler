use std::{string::String, vec::Vec};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{padded, Error, FEED_SEED, HEADER};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Ty {
    U8,
    U16,
    U32,
    U64,
    I8,
    I16,
    I32,
    I64,
    Bool,
}

impl Ty {
    pub const fn size(self) -> usize {
        match self {
            Ty::U8 | Ty::I8 | Ty::Bool => 1,
            Ty::U16 | Ty::I16 => 2,
            Ty::U32 | Ty::I32 => 4,
            Ty::U64 | Ty::I64 => 8,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Field {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: Ty,
    #[serde(default = "one", skip_serializing_if = "is_one")]
    pub len: u16,
}

fn one() -> u16 {
    1
}

fn is_one(len: &u16) -> bool {
    *len == 1
}

/// Validates the fields and gives the packed payload size.
pub fn payload_size(fields: &[Field]) -> Result<usize, Error> {
    if fields.is_empty() {
        return Err(Error::Schema("a payload needs at least one field"));
    }
    let mut size = 0;
    for field in fields {
        let mut chars = field.name.chars();
        let identifier = chars
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_');
        if !identifier {
            return Err(Error::Schema("a field name must be an identifier"));
        }
        if field.len == 0 {
            return Err(Error::Schema("a field length must be at least 1"));
        }
        size += field.ty.size() * field.len as usize;
    }
    Ok(size)
}

/// `doppler.json`: a feed is its admin and its seed. The program is
/// `create_with_seed(admin, seed, loader)`, the feed account `create_with_seed(admin, "feed", program)`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    #[serde(with = "base58")]
    pub admin: [u8; 32],
    pub seed: String,
    /// The program also takes the admin's detached signature over an update, from anyone.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pull: bool,
    pub fields: Vec<Field>,
}

impl core::fmt::Display for Manifest {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(&serde_json::to_string_pretty(self).map_err(|_| core::fmt::Error)?)
    }
}

impl core::str::FromStr for Manifest {
    type Err = serde_json::Error;

    fn from_str(json: &str) -> Result<Self, Self::Err> {
        serde_json::from_str(json)
    }
}

mod base58 {
    use serde::{de::Error as _, Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(key: &[u8; 32], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&bs58::encode(key).into_string())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<[u8; 32], D::Error> {
        let text = std::string::String::deserialize(d)?;
        let mut key = [0u8; 32];
        match bs58::decode(&text).onto(&mut key) {
            Ok(32) => Ok(key),
            _ => Err(D::Error::custom("a key is 32 bytes in base58")),
        }
    }
}

/// `BPFLoaderUpgradeab1e11111111111111111111111`.
const LOADER: [u8; 32] = [
    0x02, 0xa8, 0xf6, 0x91, 0x4e, 0x88, 0xa1, 0xb0, 0xe2, 0x10, 0x15, 0x3e, 0xf7, 0x63, 0xae, 0x2b,
    0x00, 0xc2, 0xb9, 0x3d, 0x16, 0xc1, 0x24, 0xd2, 0xc0, 0x53, 0x7a, 0x10, 0x04, 0x80, 0x00, 0x00,
];

/// `create_with_seed(admin, seed, loader)`: the program, and nothing to keep but the manifest.
pub fn program_address(admin: &[u8; 32], seed: &str) -> Result<[u8; 32], Error> {
    if seed.is_empty() || seed.len() > 32 {
        return Err(Error::Schema("a seed is 1 to 32 bytes"));
    }
    Ok(Sha256::new()
        .chain_update(admin)
        .chain_update(seed)
        .chain_update(LOADER)
        .finalize()
        .into())
}

/// `create_with_seed(admin, FEED_SEED, program)`: one feed per program.
pub fn feed_address(admin: &[u8; 32], program: &[u8; 32]) -> [u8; 32] {
    Sha256::new()
        .chain_update(admin)
        .chain_update(FEED_SEED)
        .chain_update(program)
        .finalize()
        .into()
}

/// The sequence, then the payload padded to 8 bytes.
pub fn update_data(sequence: u64, payload: &[u8]) -> Vec<u8> {
    let mut data = Vec::with_capacity(HEADER + padded(payload.len()));
    data.extend_from_slice(&sequence.to_le_bytes());
    data.extend_from_slice(payload);
    data.resize(HEADER + padded(payload.len()), 0);
    data
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field(name: &str, ty: Ty, len: u16) -> Field {
        Field {
            name: name.into(),
            ty,
            len,
        }
    }

    #[test]
    fn payload_size_is_packed() {
        let fields = [
            field("price", Ty::U64, 1),
            field("conf", Ty::U32, 1),
            field("slot", Ty::U64, 1),
        ];
        assert_eq!(payload_size(&fields).unwrap(), 20);
        assert_eq!(payload_size(&[field("id", Ty::U8, 32)]).unwrap(), 32);
    }

    #[test]
    fn payload_size_rejects_bad_schemas() {
        assert!(matches!(payload_size(&[]), Err(Error::Schema(_))));
        assert!(matches!(
            payload_size(&[field("bad-name", Ty::U8, 1)]),
            Err(Error::Schema(_))
        ));
        assert!(matches!(
            payload_size(&[field("1st", Ty::U8, 1)]),
            Err(Error::Schema(_))
        ));
        assert!(matches!(
            payload_size(&[field("x", Ty::U8, 0)]),
            Err(Error::Schema(_))
        ));
    }

    #[test]
    fn manifest_round_trips_json() {
        let json = r#"{"admin":"admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE","seed":"SOL/USD","fields":[{"name":"price","type":"u64"},{"name":"id","type":"u8","len":32}]}"#;
        let manifest: Manifest = json.parse().unwrap();
        assert_eq!(manifest.fields[0].len, 1);
        assert_eq!(manifest.admin[..4], [0x08, 0x9d, 0xbe, 0xc9]);
        assert_eq!(serde_json::to_string(&manifest).unwrap(), json);
        assert!(
            r#"{"admin":"x","seed":"SOL/USD","fields":[],"program":"fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm"}"#
                .parse::<Manifest>()
                .is_err()
        );
    }

    #[test]
    fn program_address_is_create_with_seed_under_the_loader() {
        use solana_pubkey::Pubkey;
        let loader = solana_sdk_ids::bpf_loader_upgradeable::id();
        assert_eq!(LOADER, loader.to_bytes());
        let admin = Pubkey::new_unique();
        assert_eq!(
            program_address(admin.as_array(), "SOL/USD").unwrap(),
            Pubkey::create_with_seed(&admin, "SOL/USD", &loader)
                .unwrap()
                .to_bytes()
        );
        assert!(matches!(
            program_address(admin.as_array(), ""),
            Err(Error::Schema(_))
        ));
        assert!(matches!(
            program_address(admin.as_array(), &"s".repeat(33)),
            Err(Error::Schema(_))
        ));
        assert!(program_address(admin.as_array(), &"s".repeat(32)).is_ok());
    }
}
