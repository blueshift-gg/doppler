//! Needs `cargo build-sbf --arch v3 --manifest-path program-extended/Cargo.toml`.

use doppler::{feed_address, read, update_data};
use doppler_extended_program::{ADMIN, DOMAIN, ID};
use mollusk_svm::{result::ProgramResult, Mollusk};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::{EncodableKey, Signer};

#[test]
fn push_then_pull() {
    let mollusk = Mollusk::new(
        &Pubkey::from(ID),
        "../target/deploy/doppler_extended_program",
    );
    let signer = Keypair::read_from_file("../examples/keys/admin-keypair.json").unwrap();
    assert_eq!(signer.pubkey().to_bytes(), ADMIN);
    let admin = signer.pubkey();
    let feed = Pubkey::from(feed_address(&ADMIN, &ID));
    let account = Account {
        lamports: 1_000_000,
        data: vec![0; 16],
        owner: Pubkey::from(ID),
        ..Account::default()
    };

    let push = Instruction {
        program_id: Pubkey::from(ID),
        accounts: vec![
            AccountMeta::new_readonly(admin, true),
            AccountMeta::new(feed, false),
        ],
        data: update_data(1, &1_100_000_u64.to_le_bytes()),
    };
    let pushed =
        mollusk.process_instruction(&push, &[(admin, Account::default()), (feed, account)]);
    assert_eq!(pushed.compute_units_consumed, 22);
    assert!(matches!(pushed.program_result, ProgramResult::Success));

    let value = update_data(2, &1_200_000_u64.to_le_bytes());
    let signature = signer.sign_message(&[DOMAIN, &ID, &value].concat());
    let mut data = signature.as_ref().to_vec();
    data.extend_from_slice(&value);
    let pull = Instruction {
        program_id: Pubkey::from(ID),
        accounts: vec![AccountMeta::new(feed, false)],
        data,
    };
    let feed_account = pushed.get_account(&feed).unwrap().clone();

    let mut invalid = pull.clone();
    invalid.data[0] ^= 1;
    assert!(matches!(
        mollusk
            .process_instruction(&invalid, &[(feed, feed_account.clone())])
            .program_result,
        ProgramResult::Failure(_)
    ));

    let pulled = mollusk.process_instruction(&pull, &[(feed, feed_account)]);
    assert_eq!(pulled.compute_units_consumed, 3_787);
    assert!(matches!(pulled.program_result, ProgramResult::Success));
    let account = pulled.get_account(&feed).unwrap();
    let value = read(&account.data, account.owner.as_array(), &ID, 8).unwrap();
    assert_eq!(value.sequence, 2);
    assert_eq!(value.value::<u64>(), 1_200_000);

    // Every digest reduces differently; land a run of them.
    let mut feed_account = account.clone();
    for sequence in 3..=66u64 {
        let value = update_data(
            sequence,
            &sequence.wrapping_mul(0x9e37_79b9_7f4a_7c15).to_le_bytes(),
        );
        let signature = signer.sign_message(&[DOMAIN, &ID, &value].concat());
        let pull = Instruction {
            program_id: Pubkey::from(ID),
            accounts: vec![AccountMeta::new(feed, false)],
            data: [signature.as_ref(), &value].concat(),
        };
        let pulled = mollusk.process_instruction(&pull, &[(feed, feed_account)]);
        assert!(
            matches!(pulled.program_result, ProgramResult::Success),
            "sequence {sequence}: {:?}",
            pulled.program_result
        );
        feed_account = pulled.get_account(&feed).unwrap().clone();
    }
    assert_eq!(read(&feed_account.data, &ID, &ID, 8).unwrap().sequence, 66);
}
