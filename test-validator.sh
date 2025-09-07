#!/bin/bash

set -e

solana-test-validator \
    --bpf-program fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm ./target/deploy/doppler_program.so \
    --account QUVF91dzXWYvE5FmFEc41JZxRDmNgx8S8P6sNDWYZiW ./examples/accounts/sol-usdc-price-feed-oracle.json \
    --account 9bA7GPqPpZ5aLbwb8E6cKvUPM8pcHXXTqLpf5zLAqHP5 ./examples/accounts/sol-usdt-price-feed-oracle.json \
    --account 6uQ848roY5vumz43QeQguE7xCyBSmgZbwNdJMTrs2Xhy ./examples/accounts/bonk-sol-price-feed-oracle.json \
    --account admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE ./examples/accounts/admin-account.json -r