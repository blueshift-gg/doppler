//! Bytes the TypeScript packages must reproduce. `UPDATE_VECTORS=1 cargo test -p doppler` rewrites the file.

use doppler::{feed_address, generate, update_cu, update_data, Price, HEADER, PROGRAMDATA_HEADER};
use solana_rent::Rent;

/// admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE
const ADMIN: [u8; 32] = [
    0x08, 0x9d, 0xbe, 0xc9, 0x64, 0x97, 0xab, 0xd0, 0xdb, 0x21, 0x79, 0x52, 0x69, 0xba, 0xb9, 0x4b,
    0xc8, 0xb8, 0x49, 0xcc, 0x05, 0xaa, 0x94, 0x54, 0xd0, 0xa5, 0xdc, 0x76, 0xec, 0xcb, 0x51, 0xd1,
];
/// fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm
const PROGRAM: [u8; 32] = [
    0x09, 0xe2, 0x60, 0x40, 0xff, 0x10, 0xec, 0xcf, 0xc1, 0x6a, 0xf6, 0x16, 0x9a, 0x68, 0x04, 0x78,
    0x15, 0x14, 0x33, 0x02, 0xac, 0x6e, 0x98, 0x5f, 0x70, 0x85, 0x53, 0xe1, 0x0a, 0xb6, 0xf9, 0x22,
];

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn vectors_json_matches() {
    let price = Price {
        price: 17_234_000_000,
        conf: 5_000_000,
        expo: -8,
    };
    let programs: Vec<String> = [1usize, 8, 20, 32, 39, 56, 64]
        .iter()
        .map(|&size| {
            format!(
                r#"    {{ "payloadSize": {size}, "cu": {}, "elf": "{}" }}"#,
                update_cu(size),
                hex(&generate(&ADMIN, size))
            )
        })
        .collect();
    let elf = generate(&ADMIN, Price::SIZE);
    let loaded = 5 * 64 + 22 + 36 + (PROGRAMDATA_HEADER + elf.len()) + (HEADER + Price::SIZE);
    let rent = Rent::default();
    let json = format!(
        r#"{{
  "admin": "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE",
  "program": "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm",
  "feed": "{}",
  "programs": [
{}
  ],
  "price": {{ "price": "17234000000", "conf": "5000000", "expo": -8, "sequence": 5, "data": "{}", "computeUnits": {}, "loadedBytes": {} }},
  "deploy": {{ "bufferLamports": {}, "programLamports": {}, "feedLamports": {} }}
}}
"#,
        bs58::encode(feed_address(&ADMIN, &PROGRAM)).into_string(),
        programs.join(",\n"),
        hex(&update_data(5, doppler::bytemuck::bytes_of(&price))),
        3 * 150 + update_cu(Price::SIZE),
        loaded,
        rent.minimum_balance(37 + elf.len()),
        rent.minimum_balance(36),
        rent.minimum_balance(HEADER + Price::SIZE),
    );
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/vectors.json");
    if std::env::var_os("UPDATE_VECTORS").is_some() {
        std::fs::write(path, &json).unwrap();
    }
    assert_eq!(
        std::fs::read_to_string(path).unwrap(),
        json,
        "run UPDATE_VECTORS=1 cargo test -p doppler"
    );
}
