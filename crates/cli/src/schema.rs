use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const SCALAR_TYPES: &[&str] = &["u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64", "bool"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScalarType {
    #[serde(rename = "u8")]
    U8,
    #[serde(rename = "u16")]
    U16,
    #[serde(rename = "u32")]
    U32,
    #[serde(rename = "u64")]
    U64,
    #[serde(rename = "i8")]
    I8,
    #[serde(rename = "i16")]
    I16,
    #[serde(rename = "i32")]
    I32,
    #[serde(rename = "i64")]
    I64,
    #[serde(rename = "bool")]
    Bool,
}

impl ScalarType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::U8 => "u8",
            Self::U16 => "u16",
            Self::U32 => "u32",
            Self::U64 => "u64",
            Self::I8 => "i8",
            Self::I16 => "i16",
            Self::I32 => "i32",
            Self::I64 => "i64",
            Self::Bool => "bool",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "u8" => Some(Self::U8),
            "u16" => Some(Self::U16),
            "u32" => Some(Self::U32),
            "u64" => Some(Self::U64),
            "i8" => Some(Self::I8),
            "i16" => Some(Self::I16),
            "i32" => Some(Self::I32),
            "i64" => Some(Self::I64),
            "bool" => Some(Self::Bool),
            _ => None,
        }
    }
}

pub fn scalar_size(scalar: ScalarType) -> usize {
    match scalar {
        ScalarType::U8 | ScalarType::I8 | ScalarType::Bool => 1,
        ScalarType::U16 | ScalarType::I16 => 2,
        ScalarType::U32 | ScalarType::I32 => 4,
        ScalarType::U64 | ScalarType::I64 => 8,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NormalizedField {
    pub name: String,
    #[serde(serialize_with = "serialize_scalar_type")]
    pub r#type: ScalarType,
    pub length: u32,
}

pub(crate) fn serialize_scalar_type<S>(value: &ScalarType, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str(value.as_str())
}

#[derive(Debug, Error, PartialEq)]
pub enum SchemaError {
    #[error("Payload schema must be an object")]
    NotObject,
    #[error("Payload schema must contain at least one field")]
    Empty,
    #[error("Invalid payload field name: {0}")]
    InvalidFieldName(String),
    #[error("Invalid schema for field '{0}'")]
    InvalidFieldSchema(String),
    #[error("Invalid scalar type '{0}' for field '{1}'")]
    InvalidScalarType(String, String),
    #[error("Field '{0}' length must be a positive integer")]
    InvalidLength(String),
}

const FIELD_NAME_PATTERN: &[u8] =
    b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";

fn is_valid_field_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphabetic() && first != '_' {
        return false;
    }
    chars.all(|c| FIELD_NAME_PATTERN.contains(&(c as u8)))
}

pub fn normalize_payload_schema(
    schema: &IndexMap<String, serde_json::Value>,
) -> Result<Vec<NormalizedField>, SchemaError> {
    if schema.is_empty() {
        return Err(SchemaError::Empty);
    }

    schema
        .iter()
        .map(|(name, field)| normalize_field(name, field))
        .collect()
}

fn normalize_field(name: &str, field: &serde_json::Value) -> Result<NormalizedField, SchemaError> {
    if !is_valid_field_name(name) {
        return Err(SchemaError::InvalidFieldName(name.to_string()));
    }

    let (type_str, length) = match field {
        serde_json::Value::String(scalar) => (scalar.as_str(), 1u32),
        serde_json::Value::Object(obj) => {
            let type_value = obj
                .get("type")
                .and_then(|v| v.as_str())
                .ok_or_else(|| SchemaError::InvalidFieldSchema(name.to_string()))?;
            let length_value = obj
                .get("length")
                .and_then(|v| v.as_u64())
                .ok_or_else(|| SchemaError::InvalidFieldSchema(name.to_string()))?;
            if length_value == 0 || length_value > u32::MAX as u64 {
                return Err(SchemaError::InvalidLength(name.to_string()));
            }
            (type_value, length_value as u32)
        }
        _ => return Err(SchemaError::InvalidFieldSchema(name.to_string())),
    };

    let scalar = ScalarType::parse(type_str)
        .ok_or_else(|| SchemaError::InvalidScalarType(type_str.to_string(), name.to_string()))?;

    Ok(NormalizedField {
        name: name.to_string(),
        r#type: scalar,
        length,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn schema(value: serde_json::Value) -> IndexMap<String, serde_json::Value> {
        value
            .as_object()
            .expect("object")
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    #[test]
    fn normalizes_scalar_shorthand() {
        let fields = normalize_payload_schema(&schema(json!({ "price": "u64" }))).unwrap();
        assert_eq!(
            fields,
            vec![NormalizedField {
                name: "price".into(),
                r#type: ScalarType::U64,
                length: 1,
            }]
        );
    }

    #[test]
    fn normalizes_array_descriptor() {
        let fields =
            normalize_payload_schema(&schema(json!({ "flags": { "type": "u8", "length": 32 } })))
                .unwrap();
        assert_eq!(fields[0].length, 32);
    }

    #[test]
    fn rejects_invalid_field_name() {
        let err = normalize_payload_schema(&schema(json!({ "bad-field": "u64" }))).unwrap_err();
        assert_eq!(err, SchemaError::InvalidFieldName("bad-field".into()));
    }

    #[test]
    fn rejects_invalid_scalar_type() {
        let err = normalize_payload_schema(&schema(json!({ "price": "string" }))).unwrap_err();
        assert!(matches!(err, SchemaError::InvalidScalarType(_, _)));
    }
}
