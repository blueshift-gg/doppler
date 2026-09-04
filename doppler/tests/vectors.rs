//! Bytes the TypeScript packages must reproduce. `UPDATE_VECTORS=1 cargo test -p doppler` rewrites the file.

use doppler::{
    feed_address, generate, generate_pull, padded, program_address, pull_cu, pull_message,
    update_cu, update_data, Field, Manifest, Price, Ty, HEADER, PROGRAMDATA_HEADER,
};
use doppler_sdk::{DopplerClient, SendOptions};
use sha2::{Digest, Sha256};
use solana_client::rpc_client::RpcClient;
use solana_keypair::Keypair;
use solana_rent::Rent;
use solana_signer::{EncodableKey, Signer};

/// admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE
const ADMIN: [u8; 32] = [
    0x08, 0x9d, 0xbe, 0xc9, 0x64, 0x97, 0xab, 0xd0, 0xdb, 0x21, 0x79, 0x52, 0x69, 0xba, 0xb9, 0x4b,
    0xc8, 0xb8, 0x49, 0xcc, 0x05, 0xaa, 0x94, 0x54, 0xd0, 0xa5, 0xdc, 0x76, 0xec, 0xcb, 0x51, 0xd1,
];
const SEED: &str = "SOL/USD";

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
    let programs: Vec<String> = [1usize, 8, 20, 32, 39, 40, 48, 56, 64]
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
    let program = program_address(&ADMIN, SEED).unwrap();
    let loaded = |elf: &[u8]| {
        5 * 64 + 22 + 36 + (PROGRAMDATA_HEADER + elf.len()) + (HEADER + padded(Price::SIZE))
    };
    let rent = Rent::default();
    let update = update_data(5, doppler::bytemuck::bytes_of(&price));

    // The pull programs by digest: each is 5.6 KB. Signed by examples/keys/admin-keypair.json.
    let pull_programs: Vec<String> = [1usize, 8, 20, 32, 39, 40, 48, 56, 64]
        .iter()
        .map(|&size| {
            format!(
                r#"      {{ "payloadSize": {size}, "cu": {}, "sha256": "{}" }}"#,
                pull_cu(size),
                hex(&Sha256::digest(generate_pull(&ADMIN, &program, size)))
            )
        })
        .collect();
    let pull_elf = generate_pull(&ADMIN, &program, Price::SIZE);
    let admin = Keypair::read_from_file(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../examples/keys/admin-keypair.json"
    ))
    .unwrap();
    assert_eq!(admin.pubkey().to_bytes(), ADMIN);
    let signature = admin.sign_message(&pull_message(&program, &update));

    // How the SDK packs the pull program's deploy: the write of each transaction, and whether the
    // finishing instructions fit the last one.
    let rpc = RpcClient::new("http://localhost:8899");
    let client = DopplerClient::<Price>::load(
        Manifest {
            admin: ADMIN,
            seed: SEED.into(),
            pull: true,
            fields: [("price", Ty::I64), ("conf", Ty::U64), ("expo", Ty::I32)]
                .map(|(name, ty)| Field {
                    name: name.into(),
                    ty,
                    len: 1,
                })
                .to_vec(),
        },
        SendOptions {
            rpc: &rpc,
            unit_price: 0,
        },
    )
    .unwrap();
    let deploy = client.deploy().instructions();
    let writes: Vec<String> = deploy
        .iter()
        .flat_map(|tx| tx.instructions.iter())
        .filter(|ix| ix.data.len() > 16 && ix.data[..4] == [1, 0, 0, 0])
        .map(|ix| {
            format!(
                "[{}, {}]",
                u32::from_le_bytes(ix.data[4..8].try_into().unwrap()),
                ix.data.len() - 16
            )
        })
        .collect();
    assert_eq!(writes.len(), deploy.len(), "every transaction writes once");
    let finishes_in_the_last = deploy.last().unwrap().instructions.len() == 5;
    let json = format!(
        r#"{{
  "admin": "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE",
  "seed": "{SEED}",
  "program": "{}",
  "feed": "{}",
  "programs": [
{}
  ],
  "price": {{ "price": "17234000000", "conf": "5000000", "expo": -8, "sequence": 5, "data": "{}", "computeUnits": {}, "loadedBytes": {} }},
  "deploy": {{ "bufferLamports": {}, "programLamports": {}, "feedLamports": {} }},
  "pull": {{
    "programs": [
{}
    ],
    "signed": "{}",
    "computeUnits": {},
    "loadedBytes": {},
    "bufferLamports": {},
    "deploy": {{ "writes": [{}], "finishesInTheLast": {} }}
  }}
}}
"#,
        bs58::encode(program).into_string(),
        bs58::encode(feed_address(&ADMIN, &program)).into_string(),
        programs.join(",\n"),
        hex(&update),
        3 * 150 + update_cu(Price::SIZE),
        loaded(&elf),
        rent.minimum_balance(37 + elf.len()),
        rent.minimum_balance(36),
        rent.minimum_balance(HEADER + padded(Price::SIZE)),
        pull_programs.join(",\n"),
        hex(&[signature.as_ref(), &update].concat()),
        3 * 150 + pull_cu(Price::SIZE),
        loaded(&pull_elf),
        rent.minimum_balance(37 + pull_elf.len()),
        writes.join(", "),
        finishes_in_the_last,
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
