use doppler_sdk::{Oracle, UpdateInstruction};
use solana_pubkey::Pubkey;

#[test]
fn test_oracle_creation() {
    let oracle = Oracle {
        sequence: 1,
        payload: 1000u64,
    };

    assert_eq!(oracle.sequence, 1);
    assert_eq!(oracle.payload, 1000u64);
}

#[test]
fn test_oracle_to_bytes() {
    let oracle = Oracle {
        sequence: 42,
        payload: 123u64,
    };

    let bytes = oracle.to_bytes();
    assert_eq!(bytes.len(), 16); // 8 bytes sequence + 8 bytes payload
    assert_eq!(&bytes[0..8], &42u64.to_le_bytes());
    assert_eq!(&bytes[8..16], &123u64.to_le_bytes());
}

#[test]
fn test_update_instruction_creation() {
    let admin = Pubkey::new_unique();
    let oracle_pubkey = Pubkey::new_unique();

    let oracle = Oracle {
        sequence: 1,
        payload: 1000u64,
    };

    let update_instruction = UpdateInstruction {
        admin,
        oracle_pubkey,
        oracle,
    };

    let instruction: solana_instruction::Instruction = update_instruction.into();

    assert_eq!(instruction.program_id, doppler_sdk::ID);
    assert_eq!(instruction.accounts.len(), 2);
    assert_eq!(instruction.data.len(), 16); // 8 bytes sequence + 8 bytes payload
}

#[test]
fn test_compute_unit_calculation() {
    let admin = Pubkey::new_unique();
    let oracle_pubkey = Pubkey::new_unique();

    let oracle = Oracle {
        sequence: 1,
        payload: 1000u64,
    };

    let update_instruction = UpdateInstruction {
        admin,
        oracle_pubkey,
        oracle,
    };

    let cu_limit = update_instruction.compute_unit_limit();
    assert_eq!(cu_limit, 25); // 5 + 6 + 6 + 4 + 4 = 25 CUs
}
