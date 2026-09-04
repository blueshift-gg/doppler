//! Every payload size from 1 to 64 through Mollusk: the push program, and the pull program on both
//! paths, pinned to `update_cu` and `pull_cu`.

use doppler::{
    generate, generate_pull, padded, pull_cu, pull_message, update_cu, update_data, HEADER,
};
use mollusk_svm::{
    result::{InstructionResult, ProgramResult},
    Mollusk,
};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_sdk_ids::{bpf_loader_upgradeable, system_program};
use solana_signer::Signer;

struct Rig {
    mollusk: Mollusk,
    program: Pubkey,
    keypair: Keypair,
    admin: Pubkey,
    feed: Pubkey,
}

impl Rig {
    fn new(payload_size: usize, pull: bool) -> Self {
        let (program, keypair, feed) = (Pubkey::new_unique(), Keypair::new(), Pubkey::new_unique());
        let admin = keypair.pubkey();
        let elf = if pull {
            generate_pull(admin.as_array(), program.as_array(), payload_size)
        } else {
            generate(admin.as_array(), payload_size)
        };
        let mut mollusk = Mollusk::default();
        mollusk.add_program_with_loader_and_elf(&program, &bpf_loader_upgradeable::id(), &elf);
        Self {
            mollusk,
            program,
            keypair,
            admin,
            feed,
        }
    }

    fn feed_account(&self, stored: &[u8]) -> Account {
        Account {
            lamports: 1_000_000_000,
            data: stored.to_vec(),
            owner: self.program,
            ..Account::default()
        }
    }

    /// The admin's signature over the update, from anyone.
    fn pull(&self, data: Vec<u8>, stored: &[u8]) -> InstructionResult {
        let instruction = Instruction {
            program_id: self.program,
            accounts: vec![AccountMeta::new(self.feed, false)],
            data,
        };
        self.mollusk
            .process_instruction(&instruction, &[(self.feed, self.feed_account(stored))])
    }

    fn signed(&self, ts: u64, payload: &[u8]) -> Vec<u8> {
        let update = update_data(ts, payload);
        let signature = self
            .keypair
            .sign_message(&pull_message(self.program.as_array(), &update));
        [signature.as_ref(), &update].concat()
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
            (self.feed, self.feed_account(stored)),
        ];
        self.mollusk.process_instruction(&instruction, &accounts)
    }
}

fn failed(result: &InstructionResult) -> bool {
    matches!(result.program_result, ProgramResult::Failure(_))
}

fn succeeded(result: &InstructionResult) -> bool {
    matches!(result.program_result, ProgramResult::Success)
}

fn push_sweep(pull: bool) {
    for size in 1..=64 {
        let rig = Rig::new(size, pull);
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

#[test]
fn every_payload_size_from_1_to_64() {
    push_sweep(false);
}

#[test]
fn the_pull_program_pushes_for_the_same_units() {
    push_sweep(true);
}

#[test]
fn the_pull_program_takes_the_admin_signature_from_anyone() {
    let mut measured = vec![];
    for size in 1..=64 {
        let rig = Rig::new(size, true);
        let payload: Vec<u8> = (0..size).map(|i| (i * 37 + 11) as u8).collect();
        let empty = vec![0u8; HEADER + padded(size)];
        let signed = rig.signed(7, &payload);

        let ok = rig.pull(signed.clone(), &empty);
        assert!(succeeded(&ok), "size {size}: {:?}", ok.program_result);
        let written = ok.get_account(&rig.feed).unwrap().data.clone();
        assert_eq!(written, update_data(7, &payload), "size {size}");
        let repeat = rig.pull(signed.clone(), &written);
        assert!(succeeded(&repeat), "size {size}: the same update again");
        measured.push((
            size,
            ok.compute_units_consumed,
            repeat.compute_units_consumed,
        ));

        assert!(
            failed(&rig.pull(rig.signed(6, &payload), &written)),
            "size {size}: older sequence"
        );
        let mut tampered = signed.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(
            failed(&rig.pull(tampered, &empty)),
            "size {size}: tampered payload"
        );
        let mut forged = signed.clone();
        forged[70] ^= 1;
        assert!(
            failed(&rig.pull(forged, &empty)),
            "size {size}: tampered sequence"
        );
        let mut other = Rig::new(size, true);
        other.program = rig.program;
        assert!(
            failed(&rig.pull(other.signed(8, &payload), &empty)),
            "size {size}: another key"
        );
        assert!(
            failed(&rig.pull(signed[..signed.len() - 1].to_vec(), &empty)),
            "size {size}: short"
        );
        assert!(
            failed(&rig.pull([signed.clone(), vec![0]].concat(), &empty)),
            "size {size}: long"
        );
    }
    for (size, cu, repeat) in &measured {
        println!(
            "size {size} padded {} pull {cu} formula {} repeat {repeat}",
            padded(*size),
            pull_cu(*size)
        );
    }
    for (size, cu, repeat) in measured {
        let limit = u64::from(pull_cu(size));
        assert!(
            cu <= limit && cu > limit - 80,
            "size {size}: {cu} of {limit}"
        );
        assert!(repeat < cu / 10, "size {size}: a repeat does not verify");
    }
}
