![logo](./images/logo.svg)

#  A 21 CU Solana Oracle Program

Doppler is an ultra-optimized oracle program for Solana, achieving unparalleled performance at just **21 Compute Units (CUs)** per update. Built with low-level optimizations and minimal overhead, Doppler sets the standard for high-frequency, low-latency price feeds on Solana.

## Features

- **21 CU Oracle Updates**: The most efficient oracle implementation on Solana
- **Generic Payload Support**: Flexible data structure supporting any payload type
- **Sequence-Based Updates**: Built-in replay protection and ordering guarantees
- **Zero Dependencies**: Pure no_std Rust implementation for minimal overhead
- **Direct Memory Operations**: Optimized assembly-level exits for maximum efficiency

## Architecture

Doppler uses a simple yet powerful architecture:

1. **Admin Account**: Controls oracle updates (hardcoded for security)
2. **Oracle Account**: Stores the sequence number and payload data
3. **Sequence Validation**: Ensures updates are monotonically increasing