use doppler::{MarketData, PriceFeed, PropAMM};
use doppler_sdk::{Oracle, UpdateInstruction};
use mollusk_svm::result::Check;
use mollusk_svm::{program::keyed_account_for_system_program, Mollusk};
use solana_account::Account;
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;

pub fn keyed_account_for_admin(key: Pubkey) -> (Pubkey, Account) {
    (
        key,
        Account::new(10_000_000_000, 0, &solana_program::system_program::ID),
    )
}

pub fn keyed_account_for_oracle<T: Sized + Copy>(
    mollusk: &mut Mollusk,
    admin: Pubkey,
    seed: &str,
    payload: T,
) -> (Pubkey, Account) {
    let oracle_account = Oracle {
        sequence: 0,
        payload,
    };

    let key = Pubkey::create_with_seed(&admin, seed, &doppler_sdk::ID).unwrap();

    let lamports = mollusk
        .sysvars
        .rent
        .minimum_balance(core::mem::size_of::<Oracle<T>>());

    let data = oracle_account.to_bytes();

    let account =
        Account::new_data(lamports, &data, &doppler_sdk::ID).expect("Invalid account data");

    (key, account)
}

#[test]
fn test_price_feed_oracle_update() {
    // Create Mollusk instance
    let mut mollusk = Mollusk::new(&doppler_sdk::ID, "../target/deploy/doppler");

    // Accounts
    let (admin, admin_account) = keyed_account_for_admin(doppler::ADMIN.into());
    let (oracle, oracle_account) = keyed_account_for_oracle::<PriceFeed>(
        &mut mollusk,
        doppler::ADMIN.into(),
        "SOL/USDC",
        PriceFeed { price: 100_000 },
    );
    let (system, system_account) = keyed_account_for_system_program();

    // Create oracle account
    let create_price_feed_instruction =
        solana_program::system_instruction::create_account_with_seed(
            &admin,
            &oracle,
            &admin,
            "SOL/USDC",
            oracle_account.lamports,
            oracle_account.data.len() as u64,
            &doppler_sdk::ID,
        );

    // Update oracle with new values
    let oracle_update = Oracle::<PriceFeed> {
        sequence: 1, // Increment sequence from 0 to 1
        payload: PriceFeed { price: 1_100_000 },
    };

    let price_feed_update_instruction: Instruction = UpdateInstruction {
        admin,
        oracle_pubkey: oracle,
        oracle: oracle_update,
    }
    .into();

    // Execute instruction
    let result = mollusk.process_and_validate_instruction_chain(
        &[
            (&create_price_feed_instruction, &[Check::success()]),
            (&price_feed_update_instruction, &[Check::success()]),
        ],
        &vec![
            (admin, admin_account),
            (oracle, Account::default()),
            (system, system_account),
        ],
    );

    // Get updated oracle account
    let updated_oracle = &result
        .get_account(&oracle)
        .expect("Missing oracle account")
        .data;
    println!("Updated Oracle Data: {:?}", updated_oracle);
    // Verify the oracle was updated
    assert_eq!(
        &updated_oracle[..8],
        &1u64.to_le_bytes(),
        "Sequence should be updated"
    );
    assert_eq!(
        &updated_oracle[8..16],
        &1_100_000u64.to_le_bytes(),
        "Price should be updated"
    );
}

#[test]
fn test_prop_amm_oracle_update() {
    // Create Mollusk instance
    let mut mollusk = Mollusk::new(&doppler_sdk::ID, "../target/deploy/doppler");

    // Accounts
    let (admin, admin_account) = keyed_account_for_admin(doppler::ADMIN.into());
    let (oracle, oracle_account) = keyed_account_for_oracle::<PropAMM>(
        &mut mollusk,
        doppler::ADMIN.into(),
        "SOL/USDT",
        PropAMM {
            bid: 10_000_000,
            ask: 10_050_000,
        },
    );
    let (system, system_account) = keyed_account_for_system_program();

    // Create oracle account
    let create_prop_amm_instruction = solana_program::system_instruction::create_account_with_seed(
        &admin,
        &oracle,
        &admin,
        "SOL/USDT",
        oracle_account.lamports,
        oracle_account.data.len() as u64,
        &doppler_sdk::ID,
    );

    // Update oracle with new values
    let oracle_update = Oracle::<PropAMM> {
        sequence: 1, // Increment sequence from 0 to 1
        payload: PropAMM {
            bid: 10_500_000,
            ask: 10_550_000,
        },
    };

    let prop_amm_update_instruction: Instruction = UpdateInstruction {
        admin,
        oracle_pubkey: oracle,
        oracle: oracle_update,
    }
    .into();

    // Execute instruction
    let result = mollusk.process_and_validate_instruction_chain(
        &[
            (&create_prop_amm_instruction, &[Check::success()]),
            (&prop_amm_update_instruction, &[Check::success()]),
        ],
        &vec![
            (admin, admin_account),
            (oracle, Account::default()),
            (system, system_account),
        ],
    );

    // Get updated oracle account
    let updated_oracle = &result
        .get_account(&oracle)
        .expect("Missing oracle account")
        .data;

    println!("Updated Oracle Data: {:?}", updated_oracle);
    // Verify the oracle was updated
    assert_eq!(
        &updated_oracle[..8],
        &1u64.to_le_bytes(),
        "Sequence should be updated"
    );
    assert_eq!(
        &updated_oracle[8..16],
        &10_500_000u64.to_le_bytes(),
        "Bid should be updated"
    );
    assert_eq!(
        &updated_oracle[16..24],
        &10_550_000u64.to_le_bytes(),
        "Ask should be updated"
    );
}

#[test]
fn test_market_data_oracle_update() {
    // Create Mollusk instance
    let mut mollusk = Mollusk::new(&doppler_sdk::ID, "../target/deploy/doppler");

    // Accounts
    let (admin, admin_account) = keyed_account_for_admin(doppler::ADMIN.into());
    let (oracle, oracle_account) = keyed_account_for_oracle::<MarketData>(
        &mut mollusk,
        doppler::ADMIN.into(),
        "SOL/Bonk",
        MarketData {
            price: 42_000_000,
            volume: 110_000_000,
            confidence: 500,
        },
    );
    let (system, system_account) = keyed_account_for_system_program();

    // Create oracle account
    let create_prop_amm_instruction = solana_program::system_instruction::create_account_with_seed(
        &admin,
        &oracle,
        &admin,
        "SOL/Bonk",
        oracle_account.lamports,
        oracle_account.data.len() as u64,
        &doppler_sdk::ID,
    );

    // Update oracle with new values
    let oracle_update = Oracle::<MarketData> {
        sequence: 1, // Increment sequence from 0 to 1
        payload: MarketData {
            price: 45_000_000,
            volume: 150_000_000,
            confidence: 300,
        },
    };

    let prop_amm_update_instruction: Instruction = UpdateInstruction {
        admin,
        oracle_pubkey: oracle,
        oracle: oracle_update,
    }
    .into();

    // Execute instruction
    let result = mollusk.process_and_validate_instruction_chain(
        &[
            (&create_prop_amm_instruction, &[Check::success()]),
            (&prop_amm_update_instruction, &[Check::success()]),
        ],
        &vec![
            (admin, admin_account),
            (oracle, Account::default()),
            (system, system_account),
        ],
    );

    // Get updated oracle account
    let updated_oracle = &result
        .get_account(&oracle)
        .expect("Missing oracle account")
        .data;

    println!("Updated Oracle Data: {:?}", updated_oracle);
    // Verify the oracle was updated
    assert_eq!(
        &updated_oracle[..8],
        &1u64.to_le_bytes(),
        "Sequence should be updated"
    );
    assert_eq!(
        &updated_oracle[8..16],
        &45_000_000u64.to_le_bytes(),
        "Price should be updated"
    );
    assert_eq!(
        &updated_oracle[16..24],
        &150_000_000u64.to_le_bytes(),
        "Volume should be updated"
    );
    assert_eq!(
        &updated_oracle[24..28],
        &300u32.to_le_bytes(),
        "Confidence should be updated"
    );
}
