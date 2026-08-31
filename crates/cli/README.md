# doppler-cli

CLI for generating and deploying custom Doppler program artifacts.

## Build

```sh
cargo build -p doppler-cli --release
```

The binary is installed as `doppler`.

## Usage

```sh
# Create a starter payload schema file
cargo run -p doppler-cli -- init

# Generate `.so` + `manifest.json` from a JSON schema
cargo run -p doppler-cli -- generate ./payload.json

# Deploy to a cluster
cargo run -p doppler-cli -- deploy ./doppler.so \
  --program-keypair ./keys/doppler-program-keypair.json \
  --admin <admin-address-from-manifest>
```

Schema files must be JSON. Each file should include a `payload` object with field definitions (for example `{ "price": "u64" }`), plus optional `name`, `programId`, `admin`, and `arch`.

## Tests

```sh
cargo test -p doppler-cli
```
