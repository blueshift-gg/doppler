use doppler_integration_sdk::custom::{
    CustomOraclePayload, Oracle as CustomOracle, UpdateInstruction as CustomUpdateInstruction,
    BYTECODE as CUSTOM_BYTECODE, ID as CUSTOM_ID, PAYLOAD_SIZE as CUSTOM_PAYLOAD_SIZE,
};
use doppler_integration_sdk::{
    Oracle, OraclePayload, PriceFeedIntegrationPayload, UpdateInstruction, BYTECODE, ID,
};
use mollusk_svm::result::Check;
use mollusk_svm::{program::keyed_account_for_system_program, Mollusk};
use solana_account::{Account, ReadableAccount};
use solana_clock::Epoch;
use solana_instruction::Instruction;
use solana_pubkey::{pubkey, Pubkey};
use solana_sdk_ids::{bpf_loader_upgradeable, system_program};
use solana_system_interface::instruction::create_account_with_seed;

const ADMIN: Pubkey = pubkey!("admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE");

fn keyed_account_for_admin(key: Pubkey) -> (Pubkey, Account) {
    (key, Account::new(10_000_000_000, 0, &system_program::ID))
}

fn keyed_account_for_oracle<T: OraclePayload>(
    mollusk: &Mollusk,
    admin: Pubkey,
    seed: &str,
    payload: T,
) -> (Pubkey, Account) {
    let oracle_account = Oracle {
        sequence: 0,
        payload,
    };

    let key = Pubkey::create_with_seed(&admin, seed, &ID).expect("oracle PDA");

    let lamports = mollusk.sysvars.rent.minimum_balance(Oracle::<T>::SIZE);

    let account = Account {
        lamports,
        data: oracle_account.to_bytes(),
        owner: ID,
        executable: false,
        rent_epoch: Epoch::default(),
    };

    (key, account)
}

#[test]
fn deploy_program_then_create_and_update_oracle_using_default_payload() {
    let seed = "SOL-USDC";

    let mut mollusk = Mollusk::default();
    mollusk.add_program_with_loader_and_elf(&ID, &bpf_loader_upgradeable::id(), BYTECODE);

    let (admin, admin_account) = keyed_account_for_admin(ADMIN);
    let (oracle, oracle_account) = keyed_account_for_oracle::<PriceFeedIntegrationPayload>(
        &mollusk,
        ADMIN,
        seed,
        PriceFeedIntegrationPayload { price: 0 },
    );
    let (system, system_account) = keyed_account_for_system_program();

    let create_ix = create_account_with_seed(
        &admin,
        &oracle,
        &admin,
        seed,
        oracle_account.lamports,
        oracle_account.data.len() as u64,
        &ID,
    );

    let update_ix: Instruction = UpdateInstruction {
        admin,
        oracle_pubkey: oracle,
        oracle: Oracle::<PriceFeedIntegrationPayload> {
            sequence: 1,
            payload: PriceFeedIntegrationPayload { price: 1_100_000 },
        },
    }
    .into();

    let result = mollusk.process_and_validate_instruction_chain(
        &[
            (&create_ix, &[Check::success()]),
            (&update_ix, &[Check::success(), Check::compute_units(21)]),
        ],
        &[
            (admin, admin_account),
            (oracle, Account::default()),
            (system, system_account),
        ],
    );

    let created = result
        .get_account(&oracle)
        .expect("oracle account should exist");
    assert_eq!(
        created.data().len(),
        core::mem::size_of::<Oracle<PriceFeedIntegrationPayload>>()
    );

    let oracle_state = Oracle::<PriceFeedIntegrationPayload>::from_bytes(created.data());
    assert_eq!(oracle_state.sequence, 1);
    assert_eq!(oracle_state.payload.price, 1_100_000);
}

#[test]
fn deploy_program_then_create_and_update_oracle_using_custom_payload() {
    let seed = "SOL-USDC-CUSTOM";

    let mut mollusk = Mollusk::default();
    mollusk.add_program_with_loader_and_elf(
        &CUSTOM_ID,
        &bpf_loader_upgradeable::id(),
        CUSTOM_BYTECODE,
    );

    let (admin, admin_account) = keyed_account_for_admin(ADMIN);
    let oracle = Pubkey::create_with_seed(&admin, seed, &CUSTOM_ID).expect("oracle PDA");
    let account_size = CustomOracle::<CustomOraclePayload>::SIZE;
    assert_eq!(account_size, 8 + CUSTOM_PAYLOAD_SIZE);
    assert_eq!(account_size, 17);
    let lamports = mollusk.sysvars.rent.minimum_balance(account_size);
    let (system, system_account) = keyed_account_for_system_program();

    let create_ix = create_account_with_seed(
        &admin,
        &oracle,
        &admin,
        seed,
        lamports,
        account_size as u64,
        &CUSTOM_ID,
    );

    let update_ix: Instruction = CustomUpdateInstruction {
        admin,
        oracle_pubkey: oracle,
        oracle: CustomOracle::<CustomOraclePayload> {
            sequence: 1,
            payload: CustomOraclePayload {
                decimals: 9,
                price: 1_100_000,
            },
        },
    }
    .into();

    let result = mollusk.process_and_validate_instruction_chain(
        &[
            (&create_ix, &[Check::success()]),
            (&update_ix, &[Check::success()]),
        ],
        &[
            (admin, admin_account),
            (oracle, Account::default()),
            (system, system_account),
        ],
    );

    let created = result
        .get_account(&oracle)
        .expect("oracle account should exist");
    assert_eq!(created.data().len(), account_size);

    let oracle_state = CustomOracle::<CustomOraclePayload>::from_bytes(created.data());
    assert_eq!(oracle_state.sequence, 1);
    assert_eq!(oracle_state.payload.decimals, 9);
    assert_eq!(oracle_state.payload.price, 1_100_000);
}

#[test]
fn deploy_program_then_create_and_update_oracle_with_sol_memcpy() {
    use doppler_integration_sdk::sol_memcpy::{
        Oracle as MemcpyOracle, SolMemcpyOraclePayload,
        UpdateInstruction as MemcpyUpdateInstruction, BYTECODE as MEMCPY_BYTECODE, ID as MEMCPY_ID,
        PAYLOAD_SIZE as MEMCPY_PAYLOAD_SIZE,
    };

    let seed = "SOL-USDC-MEMCPY";

    let mut mollusk = Mollusk::default();
    mollusk.add_program_with_loader_and_elf(
        &MEMCPY_ID,
        &bpf_loader_upgradeable::id(),
        MEMCPY_BYTECODE,
    );

    let (admin, admin_account) = keyed_account_for_admin(ADMIN);
    let oracle = Pubkey::create_with_seed(&admin, seed, &MEMCPY_ID).expect("oracle PDA");
    let account_size = MemcpyOracle::<SolMemcpyOraclePayload>::SIZE;
    assert_eq!(account_size, 8 + MEMCPY_PAYLOAD_SIZE);
    assert_eq!(MEMCPY_PAYLOAD_SIZE, 47);
    let lamports = mollusk.sysvars.rent.minimum_balance(account_size);
    let (system, system_account) = keyed_account_for_system_program();

    let create_ix = create_account_with_seed(
        &admin,
        &oracle,
        &admin,
        seed,
        lamports,
        account_size as u64,
        &MEMCPY_ID,
    );

    let update_ix: Instruction = MemcpyUpdateInstruction {
        admin,
        oracle_pubkey: oracle,
        oracle: MemcpyOracle::<SolMemcpyOraclePayload> {
            sequence: 1,
            payload: SolMemcpyOraclePayload {
                head: 42,
                a: 1,
                b: 2,
                c: 3,
                d: 4,
                tag: 300,
                seq_lo: 7,
                flags: 0xCD,
            },
        },
    }
    .into();

    let result = mollusk.process_and_validate_instruction_chain(
        &[
            (&create_ix, &[Check::success()]),
            (&update_ix, &[Check::success()]),
        ],
        &[
            (admin, admin_account),
            (oracle, Account::default()),
            (system, system_account),
        ],
    );

    let created = result
        .get_account(&oracle)
        .expect("oracle account should exist");
    assert_eq!(created.data().len(), account_size);

    let oracle_state = MemcpyOracle::<SolMemcpyOraclePayload>::from_bytes(created.data());
    assert_eq!(oracle_state.sequence, 1);
    assert_eq!(oracle_state.payload.head, 42);
    assert_eq!(oracle_state.payload.a, 1);
    assert_eq!(oracle_state.payload.b, 2);
    assert_eq!(oracle_state.payload.c, 3);
    assert_eq!(oracle_state.payload.d, 4);
    assert_eq!(oracle_state.payload.tag, 300);
    assert_eq!(oracle_state.payload.seq_lo, 7);
    assert_eq!(oracle_state.payload.flags, 0xCD);
}
