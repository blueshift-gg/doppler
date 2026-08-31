use crate::schema::{normalize_payload_schema, scalar_size, SchemaError};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LayoutField {
    pub name: String,
    #[serde(serialize_with = "crate::schema::serialize_scalar_type")]
    pub r#type: crate::schema::ScalarType,
    pub length: u32,
    pub offset: u32,
    pub size: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PayloadLayout {
    pub fields: Vec<LayoutField>,
    pub payload_size: u32,
}

pub fn compute_payload_layout(
    schema: &IndexMap<String, serde_json::Value>,
) -> Result<PayloadLayout, SchemaError> {
    let normalized = normalize_payload_schema(schema)?;
    let mut fields = Vec::with_capacity(normalized.len());
    let mut offset = 0u32;

    for field in normalized {
        let unit = scalar_size(field.r#type) as u32;
        let size = unit * field.length;
        fields.push(LayoutField {
            name: field.name,
            r#type: field.r#type,
            length: field.length,
            offset,
            size,
        });
        offset += size;
    }

    Ok(PayloadLayout {
        fields,
        payload_size: offset,
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
    fn computes_packed_scalar_layout() {
        let layout = compute_payload_layout(&schema(json!({ "price": "u64" }))).unwrap();
        assert_eq!(layout.payload_size, 8);
        assert_eq!(layout.fields.len(), 1);
        assert_eq!(layout.fields[0].offset, 0);
        assert_eq!(layout.fields[0].size, 8);
    }

    #[test]
    fn computes_packed_mixed_layout_without_padding() {
        let mut schema = IndexMap::new();
        schema.insert("price".into(), serde_json::json!("u64"));
        schema.insert("confidence".into(), serde_json::json!("u32"));
        schema.insert("slot".into(), serde_json::json!("u64"));
        let layout = compute_payload_layout(&schema).unwrap();
        assert_eq!(layout.payload_size, 20);
        assert_eq!(layout.fields[0].offset, 0);
        assert_eq!(layout.fields[1].offset, 8);
        assert_eq!(layout.fields[2].offset, 12);
    }

    #[test]
    fn computes_fixed_array_layout() {
        let layout =
            compute_payload_layout(&schema(json!({ "flags": { "type": "u8", "length": 32 } })))
                .unwrap();
        assert_eq!(layout.payload_size, 32);
    }
}
