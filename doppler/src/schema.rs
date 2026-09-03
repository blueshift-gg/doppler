use std::{string::String, vec::Vec};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{Error, FEED_SEED, HEADER};

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    pub offsets: Vec<usize>,
    pub size: usize,
}

pub fn layout(fields: &[Field]) -> Result<Layout, Error> {
    if fields.is_empty() {
        return Err(Error::Schema("a payload needs at least one field"));
    }
    let mut offsets = Vec::with_capacity(fields.len());
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
        offsets.push(size);
        size += field.ty.size() * field.len as usize;
    }
    Ok(Layout { offsets, size })
}

/// `doppler.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    #[serde(with = "base58")]
    pub program: [u8; 32],
    #[serde(with = "base58")]
    pub admin: [u8; 32],
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

/// `create_with_seed(admin, FEED_SEED, program)`: one feed per program.
pub fn feed_address(admin: &[u8; 32], program: &[u8; 32]) -> [u8; 32] {
    Sha256::new()
        .chain_update(admin)
        .chain_update(FEED_SEED)
        .chain_update(program)
        .finalize()
        .into()
}

pub fn update_data(last_updated_ms: u64, payload: &[u8]) -> Vec<u8> {
    let mut data = Vec::with_capacity(HEADER + payload.len());
    data.extend_from_slice(&last_updated_ms.to_le_bytes());
    data.extend_from_slice(payload);
    data
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::vec;

    fn field(name: &str, ty: Ty, len: u16) -> Field {
        Field {
            name: name.into(),
            ty,
            len,
        }
    }

    #[test]
    fn layout_is_packed() {
        let fields = [
            field("price", Ty::U64, 1),
            field("conf", Ty::U32, 1),
            field("slot", Ty::U64, 1),
        ];
        assert_eq!(
            layout(&fields).unwrap(),
            Layout {
                offsets: vec![0, 8, 12],
                size: 20
            }
        );
        assert_eq!(layout(&[field("id", Ty::U8, 32)]).unwrap().size, 32);
    }

    #[test]
    fn layout_rejects_bad_schemas() {
        assert!(matches!(layout(&[]), Err(Error::Schema(_))));
        assert!(matches!(
            layout(&[field("bad-name", Ty::U8, 1)]),
            Err(Error::Schema(_))
        ));
        assert!(matches!(
            layout(&[field("1st", Ty::U8, 1)]),
            Err(Error::Schema(_))
        ));
        assert!(matches!(
            layout(&[field("x", Ty::U8, 0)]),
            Err(Error::Schema(_))
        ));
    }

    #[test]
    fn manifest_round_trips_json() {
        let json = r#"{"program":"fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm","admin":"admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE","fields":[{"name":"price","type":"u64"},{"name":"id","type":"u8","len":32}]}"#;
        let manifest: Manifest = json.parse().unwrap();
        assert_eq!(manifest.fields[0].len, 1);
        assert_eq!(manifest.admin[..4], [0x08, 0x9d, 0xbe, 0xc9]);
        assert_eq!(serde_json::to_string(&manifest).unwrap(), json);
        assert!(
            r#"{"program":"short","admin":"x","fields":[],"program_data_len":0}"#
                .parse::<Manifest>()
                .is_err()
        );
    }
}
