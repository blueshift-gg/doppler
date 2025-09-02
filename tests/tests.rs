use doppler_sdk::{Oracle, PropAMM, UpdateInstruction};
use mollusk_svm::{Mollusk, program::keyed_account_for_system_program};
use mollusk_svm::result::Check;
use solana_pubkey::Pubkey;
use solana_account::{Account, ReadableAccount};
use solana_instruction::{AccountMeta, Instruction};

pub fn keyed_account_for_admin(key: Pubkey) -> (Pubkey, Account) {
    (key, Account::new(10_000_000_000, 0, &solana_program::system_program::ID))
}

pub fn keyed_account_for_oracle(mollusk: &mut Mollusk, admin: Pubkey, seed: &str) -> (Pubkey, Account) {
    let oracle_account = Oracle {
        sequence: 0,
        payload: PropAMM {
            bid: 1_000_000,
            ask: 1_000_000,
        },
    };

    let data_len = core::mem::size_of::<Oracle<PropAMM>>();

    let key = Pubkey::create_with_seed(&admin, seed, &doppler_sdk::ID).unwrap();

    let lamports = mollusk.sysvars.rent.minimum_balance(data_len);

    // PropAMM is 16 bytes (2 u64s), Oracle adds 8 bytes for sequence, total = 24
    let data: [u8; 24] = oracle_account.to_bytes();
    
    let account = Account::new_data(
        lamports,
        &data,
        &doppler_sdk::ID
    ).unwrap();

    (key, account)
}

#[test]
fn test_oracle_update() {    
    // Create Mollusk instance
    let mut mollusk = Mollusk::new(&doppler_sdk::ID, "target/deploy/doppler");
    
    // Accounts
    let (admin, admin_account) = keyed_account_for_admin(doppler::ADMIN.into());
    let (oracle, oracle_account) = keyed_account_for_oracle(&mut mollusk, doppler::ADMIN.into(), "SOL/USDC");
    let (system, system_account) = keyed_account_for_system_program();
    
    // Create oracle account
    let create_instruction = solana_program::system_instruction::create_account_with_seed(&admin, &oracle, &admin, "SOL/USDC", oracle_account.lamports, oracle_account.data.len() as u64, &doppler_sdk::ID);
    
    // Update oracle with new values
    let oracle_update = Oracle {
        sequence: 1,  // Increment sequence
        payload: PropAMM {
            bid: 1_100_000,
            ask: 1_200_000,
        },
    };
    
    let update_instruction: Instruction = UpdateInstruction {
        admin,
        oracle_pubkey: oracle,
        oracle: oracle_update,
    }.into();
    
    // Execute instruction
    let result = mollusk.process_and_validate_instruction_chain(
        &[
            (&create_instruction, &[Check::success()]),
            (&update_instruction, &[Check::success()])
        ],
        &vec![
            (admin, admin_account),
            (oracle, Account::default()),
            (system, system_account),
        ],
    );
    
    // Get updated oracle account
    let updated_oracle = result.get_account(&oracle).unwrap().data.as_slice();
    
    // Safely deserialize the data
    assert!(updated_oracle.len() >= 24, "Oracle data should be at least 24 bytes");
    
    // Read sequence (first 8 bytes)
    let sequence = u64::from_le_bytes(updated_oracle[0..8].try_into().unwrap());
    
    // Read PropAMM payload (next 16 bytes)
    let bid = u64::from_le_bytes(updated_oracle[8..16].try_into().unwrap());
    let ask = u64::from_le_bytes(updated_oracle[16..24].try_into().unwrap());
    
    let updated_data = Oracle {
        sequence,
        payload: PropAMM { bid, ask },
    };
    
    // Verify the oracle was updated
    assert_eq!(updated_data.sequence, 1, "Sequence should be updated");
    assert_eq!(updated_data.payload.ask, 1_200_000, "Ask price should be updated");
    assert_eq!(updated_data.payload.bid, 1_100_000, "Bid price should be updated");
}