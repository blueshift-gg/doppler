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

pub use accounts::{Oracle, OraclePayload, UpdateInstruction};
pub use constants::ID;

include!(concat!(env!("OUT_DIR"), "/lib_body.rs"));

pub const BYTECODE: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/doppler.so"));

pub mod custom {
    mod accounts {
        include!(concat!(env!("OUT_DIR"), "/custom_accounts.rs"));
    }
    mod constants {
        include!(concat!(env!("OUT_DIR"), "/custom_constants.rs"));
    }
    pub mod transaction {
        include!(concat!(env!("OUT_DIR"), "/custom_transaction.rs"));
    }

    pub use accounts::{Oracle, OraclePayload, UpdateInstruction};
    pub use constants::ID;

    include!(concat!(env!("OUT_DIR"), "/custom_lib_body.rs"));

    pub const BYTECODE: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/custom/doppler.so"));
}

pub mod sol_memcpy {
    mod accounts {
        include!(concat!(env!("OUT_DIR"), "/sol_memcpy_accounts.rs"));
    }
    mod constants {
        include!(concat!(env!("OUT_DIR"), "/sol_memcpy_constants.rs"));
    }
    pub mod transaction {
        include!(concat!(env!("OUT_DIR"), "/sol_memcpy_transaction.rs"));
    }

    pub use accounts::{Oracle, OraclePayload, UpdateInstruction};
    pub use constants::ID;

    include!(concat!(env!("OUT_DIR"), "/sol_memcpy_lib_body.rs"));

    pub const BYTECODE: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/sol_memcpy/doppler.so"));
}
