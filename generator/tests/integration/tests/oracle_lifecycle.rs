use doppler_integration_sdk::{Oracle, PriceFeedIntegrationPayload, UpdateInstruction, BYTECODE, ID};
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
    (
        key,
        Account::new(10_000_000_000, 0, &system_program::ID),
    )
}

fn keyed_account_for_oracle<T: Sized + Copy>(
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

    let lamports = mollusk
        .sysvars
        .rent
        .minimum_balance(core::mem::size_of::<Oracle<T>>());

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
fn deploy_program_then_create_and_update_oracle() {
    let seed = "SOL-USDC";

    let mut mollusk = Mollusk::default();
    mollusk.add_program_with_loader_and_elf(
        &ID,
        &bpf_loader_upgradeable::id(),
        BYTECODE,
    );

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
            (&update_ix, &[Check::success()]),
        ],
        &[
            (admin, admin_account),
            (oracle, Account::default()),
            (system, system_account),
        ],
    );

    let created = result.get_account(&oracle).expect("oracle account should exist");
    assert_eq!(created.data().len(), core::mem::size_of::<Oracle<PriceFeedIntegrationPayload>>());

    let oracle_state = Oracle::<PriceFeedIntegrationPayload>::from_bytes(created.data());
    assert_eq!(oracle_state.sequence, 1);
    assert_eq!(oracle_state.payload.price, 1_100_000);
}
