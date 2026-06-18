# doppler-sdk

Doppler oracle SDK for applications using Rust.

## Install

```toml
[dependencies]
doppler-sdk = "0.1.0"
solana-client = "3.0"
solana-keypair = "3.1"
solana-pubkey = "4.1"
solana-signer = "3.0"
```

## Usage

```rust
use doppler_sdk::{transaction::Builder, Oracle};
use solana_client::rpc_client::RpcClient;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;

#[repr(C)]
#[derive(Clone, Copy)]
struct PriceFeed {
    price: u64,
}

let client = RpcClient::new("https://api.mainnet-beta.solana.com".to_string());
let admin = Keypair::new();
let oracle_pubkey: Pubkey = "...".parse().unwrap();

let account = client.get_account(&oracle_pubkey).unwrap();
let oracle = Oracle::<PriceFeed>::from_bytes(&account.data);

let recent_blockhash = client.get_latest_blockhash().unwrap();
let transaction = Builder::new(&admin)
    .add_oracle_update(
        oracle_pubkey,
        Oracle {
            sequence: oracle.sequence + 1,
            payload: PriceFeed { price: 42_000_000 },
        },
    )
    .with_unit_price(1_000)
    .build(recent_blockhash);
```

`ID` is the default Doppler program ID. Custom bytecode from the generator exports the same constant in generated Rust SDKs.
