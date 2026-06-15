#![allow(clippy::all, dead_code, unused_imports)]

mod accounts {
    include!(concat!(env!("OUT_DIR"), "/accounts.rs"));
}
mod constants {
    include!(concat!(env!("OUT_DIR"), "/constants.rs"));
}
pub mod transaction {
    include!(concat!(env!("OUT_DIR"), "/transaction.rs"));
}

pub use accounts::{Oracle, UpdateInstruction};
pub use constants::ID;

include!(concat!(env!("OUT_DIR"), "/lib_body.rs"));

pub const BYTECODE: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/doppler.so"));
