#!/bin/bash

set -eo pipefail

PROGRAM_ID="fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm"
UPGRADE_AUTHORITY="admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE"
SO_PATH="target/deploy/doppler_program.so"
ACCOUNTS_DIR="examples/accounts"
TOOLS_VERSION="v1.54"

command -v jq >/dev/null || { echo "jq is required (brew install jq)" >&2; exit 1; }

# Install the pinned platform-tools if missing (fresh machine won't have them).
if [ ! -d "$HOME/.cache/solana/$TOOLS_VERSION" ]; then
    echo "platform-tools $TOOLS_VERSION missing; installing..."
    cargo build-sbf --install-only --tools-version "$TOOLS_VERSION"
fi

if [ ! -f "$SO_PATH" ]; then
    cargo build-sbf --tools-version "$TOOLS_VERSION" --manifest-path program/Cargo.toml
fi

account_args=()
for f in "$ACCOUNTS_DIR"/*.json; do
    account_args+=(--account "$(jq -r '.pubkey' "$f")" "$f")
done

exec solana-test-validator --reset \
    --upgradeable-program "$PROGRAM_ID" "$SO_PATH" "$UPGRADE_AUTHORITY" \
    "${account_args[@]}" \
    "$@"
