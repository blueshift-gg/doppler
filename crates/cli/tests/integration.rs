mod common;

use common::custom::{
    bytecode as custom_bytecode, CustomOraclePayload, PAYLOAD_SIZE as CUSTOM_PAYLOAD_SIZE,
};
use common::sol_memcpy::{
    bytecode as sol_memcpy_bytecode, SolMemcpyOraclePayload, PAYLOAD_SIZE as MEMCPY_PAYLOAD_SIZE,
};
use common::{
    fixture_bytecode, keyed_account_for_admin, keyed_account_for_oracle, Oracle,
    PriceFeedIntegrationPayload, UpdateInstruction, ADMIN, ID,
};
use mollusk_svm::result::Check;
use mollusk_svm::{program::keyed_account_for_system_program, Mollusk};
use solana_account::{Account, ReadableAccount};
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;
use solana_sdk_ids::bpf_loader_upgradeable;
use solana_system_interface::instruction::create_account_with_seed;

#[test]
fn deploy_program_then_create_and_update_oracle_using_default_payload() {
    let seed = "SOL-USDC";
    let bytecode = fixture_bytecode("schema.json");

    let mut mollusk = Mollusk::default();
    mollusk.add_program_with_loader_and_elf(&ID, &bpf_loader_upgradeable::id(), &bytecode);

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
        program_id: ID,
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
        Oracle::<PriceFeedIntegrationPayload>::size()
    );

    let oracle_state = Oracle::<PriceFeedIntegrationPayload>::from_bytes(created.data());
    assert_eq!(oracle_state.sequence, 1);
    assert_eq!(oracle_state.payload.price, 1_100_000);
}

#[test]
fn deploy_program_then_create_and_update_oracle_using_custom_payload() {
    let seed = "SOL-USDC-CUSTOM";
    let bytecode = custom_bytecode();

    let mut mollusk = Mollusk::default();
    mollusk.add_program_with_loader_and_elf(&ID, &bpf_loader_upgradeable::id(), &bytecode);

    let (admin, admin_account) = keyed_account_for_admin(ADMIN);
    let oracle = Pubkey::create_with_seed(&admin, seed, &ID).expect("oracle PDA");
    let account_size = Oracle::<CustomOraclePayload>::size();
    assert_eq!(account_size, 8 + CUSTOM_PAYLOAD_SIZE);
    assert_eq!(CUSTOM_PAYLOAD_SIZE, 48);
    assert!(
        CUSTOM_PAYLOAD_SIZE > MEMCPY_PAYLOAD_SIZE,
        "48 bytes packs into six 8-byte copy pairs, while the sol_memcpy fixture \
         uses {MEMCPY_PAYLOAD_SIZE} bytes with a trailing u32/u16/u8 tail that \
         greedy chunking expands to eight pairs"
    );
    let lamports = mollusk.sysvars.rent.minimum_balance(account_size);
    let (system, system_account) = keyed_account_for_system_program();

    let create_ix = create_account_with_seed(
        &admin,
        &oracle,
        &admin,
        seed,
        lamports,
        account_size as u64,
        &ID,
    );

    let update_ix: Instruction = UpdateInstruction {
        program_id: ID,
        admin,
        oracle_pubkey: oracle,
        oracle: Oracle::<CustomOraclePayload> {
            sequence: 1,
            payload: CustomOraclePayload {
                bid: 10_500_000,
                ask: 10_550_000,
                mid: 10_525_000,
                leg_a: 1,
                leg_b: 2,
                leg_c: 3,
                leg_d: 4,
                leg_e: 5,
                leg_f: 6,
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

    let oracle_state = Oracle::<CustomOraclePayload>::from_bytes(created.data());
    assert_eq!(oracle_state.sequence, 1);
    assert_eq!(oracle_state.payload.bid, 10_500_000);
    assert_eq!(oracle_state.payload.ask, 10_550_000);
    assert_eq!(oracle_state.payload.mid, 10_525_000);
    assert_eq!(oracle_state.payload.leg_a, 1);
    assert_eq!(oracle_state.payload.leg_b, 2);
    assert_eq!(oracle_state.payload.leg_c, 3);
    assert_eq!(oracle_state.payload.leg_d, 4);
    assert_eq!(oracle_state.payload.leg_e, 5);
    assert_eq!(oracle_state.payload.leg_f, 6);
}

#[test]
fn deploy_program_then_create_and_update_oracle_with_sol_memcpy() {
    let seed = "SOL-USDC-MEMCPY";
    let bytecode = sol_memcpy_bytecode();

    let mut mollusk = Mollusk::default();
    mollusk.add_program_with_loader_and_elf(&ID, &bpf_loader_upgradeable::id(), &bytecode);

    let (admin, admin_account) = keyed_account_for_admin(ADMIN);
    let oracle = Pubkey::create_with_seed(&admin, seed, &ID).expect("oracle PDA");
    let account_size = Oracle::<SolMemcpyOraclePayload>::size();
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
        &ID,
    );

    let update_ix: Instruction = UpdateInstruction {
        program_id: ID,
        admin,
        oracle_pubkey: oracle,
        oracle: Oracle::<SolMemcpyOraclePayload> {
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

    let sequence = u64::from_le_bytes(created.data()[..8].try_into().expect("sequence bytes"));
    let payload = unsafe {
        created.data()[8..]
            .as_ptr()
            .cast::<SolMemcpyOraclePayload>()
            .read_unaligned()
    };
    assert_eq!(sequence, 1);
    assert_eq!(
        unsafe { core::ptr::addr_of!(payload.head).read_unaligned() },
        42
    );
    assert_eq!(
        unsafe { core::ptr::addr_of!(payload.a).read_unaligned() },
        1
    );
    assert_eq!(
        unsafe { core::ptr::addr_of!(payload.b).read_unaligned() },
        2
    );
    assert_eq!(
        unsafe { core::ptr::addr_of!(payload.c).read_unaligned() },
        3
    );
    assert_eq!(
        unsafe { core::ptr::addr_of!(payload.d).read_unaligned() },
        4
    );
    assert_eq!(
        unsafe { core::ptr::addr_of!(payload.tag).read_unaligned() },
        300
    );
    assert_eq!(
        unsafe { core::ptr::addr_of!(payload.seq_lo).read_unaligned() },
        7
    );
    assert_eq!(payload.flags, 0xCD);
}
