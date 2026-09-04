//! Every payload size from 1 to 64 through Mollusk, pinned to `update_cu`.

use doppler::{generate, padded, update_cu, update_data, HEADER};
use mollusk_svm::{
    result::{InstructionResult, ProgramResult},
    Mollusk,
};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;
use solana_sdk_ids::{bpf_loader_upgradeable, system_program};

struct Rig {
    mollusk: Mollusk,
    program: Pubkey,
    admin: Pubkey,
    feed: Pubkey,
}

impl Rig {
    fn new(payload_size: usize) -> Self {
        let (program, admin, feed) = (
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        );
        let mut mollusk = Mollusk::default();
        mollusk.add_program_with_loader_and_elf(
            &program,
            &bpf_loader_upgradeable::id(),
            &generate(admin.as_array(), payload_size),
        );
        Self {
            mollusk,
            program,
            admin,
            feed,
        }
    }

    fn update(
        &self,
        signer: Pubkey,
        is_signer: bool,
        ts: u64,
        payload: &[u8],
        stored: &[u8],
    ) -> InstructionResult {
        let instruction = Instruction {
            program_id: self.program,
            accounts: vec![
                AccountMeta {
                    pubkey: signer,
                    is_signer,
                    is_writable: false,
                },
                AccountMeta::new(self.feed, false),
            ],
            data: update_data(ts, payload),
        };
        let accounts = [
            (
                signer,
                Account::new(1_000_000_000, 0, &system_program::id()),
            ),
            (
                self.feed,
                Account {
                    lamports: 1_000_000_000,
                    data: stored.to_vec(),
                    owner: self.program,
                    ..Account::default()
                },
            ),
        ];
        self.mollusk.process_instruction(&instruction, &accounts)
    }
}

fn failed(result: &InstructionResult) -> bool {
    matches!(result.program_result, ProgramResult::Failure(_))
}

#[test]
fn every_payload_size_from_1_to_64() {
    for size in 1..=64 {
        let rig = Rig::new(size);
        let payload: Vec<u8> = (0..size).map(|i| (i * 37 + 11) as u8).collect();
        let empty = vec![0u8; HEADER + padded(size)];

        let ok = rig.update(rig.admin, true, 7, &payload, &empty);
        assert!(
            matches!(ok.program_result, ProgramResult::Success),
            "size {size}: {:?}",
            ok.program_result
        );
        let written = ok.get_account(&rig.feed).unwrap().data.clone();
        assert_eq!(written, update_data(7, &payload), "size {size}");
        assert_eq!(
            ok.compute_units_consumed,
            u64::from(update_cu(size)),
            "size {size}"
        );

        assert!(
            failed(&rig.update(rig.admin, true, 7, &payload, &written)),
            "size {size}: same sequence"
        );
        assert!(
            failed(&rig.update(rig.admin, true, 6, &payload, &written)),
            "size {size}: older sequence"
        );
        assert!(
            failed(&rig.update(rig.admin, false, 8, &payload, &written)),
            "size {size}: not signing"
        );
        assert!(
            failed(&rig.update(Pubkey::new_unique(), true, 8, &payload, &written)),
            "size {size}: wrong key"
        );
    }
}
