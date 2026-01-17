#!/bin/bash

set -e 

# Check if the program binary exists, and build it if not
[ ! -f "./target/deploy/doppler_program.so" ] && cargo build-sbf --manifest-path program/Cargo.toml

# Check if Surfpool is available on the environment
if ! command -v surfpool &> /dev/null; then
    echo "Surfpool is not installed"
    echo ""
    echo "Install with:"
    echo "  brew install txtx/taps/surfpool  # macOS"
    echo "  # or build from source: https://github.com/txtx/surfpool"
    exit 1
fi

echo "Starting Surfpool..."

surfpool start "$@"