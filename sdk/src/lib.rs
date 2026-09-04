//! Rust client for Doppler feeds: `load` a manifest, `deploy` once, then `update` and `read`. With
//! a pull manifest the admin signs off chain, `update(..).sign(&admin)`, and anyone lands the bytes,
//! `pull(&signed).send(&[&relayer])`.

use std::{
    fmt,
    marker::PhantomData,
    time::{SystemTime, UNIX_EPOCH},
};

pub use doppler;
use doppler::{
    feed_address, generate, generate_pull, padded, payload_size, program_address, pull_cu,
    pull_message, read, update_cu, update_data, Manifest, Pod, FEED_SEED, HEADER,
    PROGRAMDATA_HEADER,
};
use solana_client::{client_error::ClientError, rpc_client::RpcClient};
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_hash::Hash;
use solana_instruction::{AccountMeta, Instruction};
use solana_loader_v3_interface::{instruction as loader, state::UpgradeableLoaderState};
use solana_message::Message;
use solana_packet::PACKET_DATA_SIZE;
use solana_pubkey::Pubkey;
use solana_rent::Rent;
use solana_sdk_ids::{bpf_loader_upgradeable, system_program, sysvar};
use solana_signature::Signature;
use solana_signer::{signers::Signers, Signer, SignerError};
use solana_system_interface::instruction::create_account_with_seed;
use solana_transaction::Transaction;

/// `DEFAULT_COMPUTE_UNITS` of the system and compute-budget builtins.
const BUILTIN_IX_CU: u32 = 150;
/// `DEFAULT_COMPUTE_UNITS` of loader v3; its deploy also CPIs one system `create_account`.
const LOADER_IX_CU: u32 = 2_370;
/// SIMD-0186.
const ACCOUNT_OVERHEAD: u32 = 64;
const COMPUTE_BUDGET_PROGRAM_LEN: u32 = "compute_budget_program".len() as u32;
/// Loader-v3 program account: tag, programdata address.
const PROGRAM_ACCOUNT_LEN: u32 = 4 + 32;
/// The buffer lives only until the deploy, so one seed serves every deploy.
const BUFFER_SEED: &str = "buf";
/// `FeeStructure::default()`.
const LAMPORTS_PER_SIGNATURE: u64 = 5_000;
const SIGNATURE: usize = 64;

/// Builtin and sysvar data as loaded: the system program, 21 bytes on mainnet and 14 on devnet,
/// where a limit only needs to cover the larger; the loader; the rent and clock sysvars.
fn builtin_len(key: &Pubkey) -> u32 {
    match *key {
        k if k == system_program::id() => 21,
        k if k == bpf_loader_upgradeable::id() => 37,
        k if k == sysvar::rent::id() => 17,
        k if k == sysvar::clock::id() => 40,
        _ => 0,
    }
}

#[derive(Debug)]
pub enum Error {
    Doppler(doppler::Error),
    Rpc(ClientError),
    Payload { manifest: usize, value: usize },
    Missing(Pubkey),
    Sign(SignerError),
    PushOnly,
    Signed { expected: usize, got: usize },
    Payer,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Doppler(e) => e.fmt(f),
            Error::Rpc(e) => e.fmt(f),
            Error::Payload { manifest, value } => {
                write!(
                    f,
                    "the manifest payload is {manifest} bytes, the value type is {value}"
                )
            }
            Error::Missing(key) => write!(f, "{key} must sign"),
            Error::Sign(e) => e.fmt(f),
            Error::PushOnly => f.write_str("the manifest has no pull path"),
            Error::Signed { expected, got } => {
                write!(f, "a signed update is {expected} bytes, got {got}")
            }
            Error::Payer => f.write_str("a pull needs a signer to pay"),
        }
    }
}

impl std::error::Error for Error {}

impl From<doppler::Error> for Error {
    fn from(e: doppler::Error) -> Self {
        Error::Doppler(e)
    }
}

impl From<ClientError> for Error {
    fn from(e: ClientError) -> Self {
        Error::Rpc(e)
    }
}

impl From<SignerError> for Error {
    fn from(e: SignerError) -> Self {
        Error::Sign(e)
    }
}

/// Sign with every signer the message requires, ignore the ones it does not, and name the
/// first one it still lacks.
fn sign<S: Signers + ?Sized>(tx: &mut Transaction, signers: &S) -> Result<(), Error> {
    let message = tx.message_data();
    let keys = signers.pubkeys();
    let signatures = signers.try_sign_message(&message)?;
    let required = tx.message.header.num_required_signatures as usize;
    for (key, signature) in keys.iter().zip(signatures) {
        if let Some(position) = tx.message.account_keys[..required]
            .iter()
            .position(|k| k == key)
        {
            tx.signatures[position] = signature;
        }
    }
    match tx
        .signatures
        .iter()
        .position(|s| *s == Signature::default())
    {
        Some(missing) => Err(Error::Missing(tx.message.account_keys[missing])),
        None => Ok(()),
    }
}

/// `unit_price` is the priority fee in micro-lamports per compute unit.
#[derive(Clone, Copy)]
pub struct SendOptions<'a> {
    pub rpc: &'a RpcClient,
    pub unit_price: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Reading<T> {
    pub sequence: u64,
    pub value: T,
}

/// `compute_units` and `loaded_bytes` are the instructions' own: what they add to any transaction,
/// with every account at SIMD-0186's 64 bytes plus data. The `requested_` pair is what `send` sets
/// for a transaction holding only them: three compute-budget builtins at 150 units, and the payer
/// and the compute-budget program. `lamports` is that transaction's fee at `options.unit_price`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Budget {
    pub compute_units: u32,
    pub loaded_bytes: u32,
    pub requested_compute_units: u32,
    pub requested_loaded_bytes: u32,
    pub lamports: u64,
}

/// The raw update instruction and its budget.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateInstruction {
    pub instruction: Instruction,
    pub budget: Budget,
}

/// The raw instructions of one deploy transaction and their budget.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeployInstructions {
    pub instructions: Vec<Instruction>,
    pub budget: Budget,
}

/// `ceil(unit_price * compute_units / 1_000_000)`, as the fee structure prices it.
const fn priority_fee(unit_price: u64, compute_units: u32) -> u64 {
    (unit_price as u128 * compute_units as u128).div_ceil(1_000_000) as u64
}

/// One program, one admin, one payload type, one feed account, one way to send.
pub struct DopplerClient<'a, T> {
    pub manifest: Manifest,
    pub options: SendOptions<'a>,
    program: Pubkey,
    admin: Pubkey,
    value: PhantomData<T>,
}

impl<'a, T: Pod> DopplerClient<'a, T> {
    /// Checks `T` against the manifest's fields and derives the program and the feed account.
    pub fn load(manifest: Manifest, options: SendOptions<'a>) -> Result<Self, Error> {
        let size = payload_size(&manifest.fields)?;
        if size != size_of::<T>() {
            return Err(Error::Payload {
                manifest: size,
                value: size_of::<T>(),
            });
        }
        Ok(Self {
            program: Pubkey::from(program_address(&manifest.admin, &manifest.seed)?),
            admin: Pubkey::from(manifest.admin),
            options,
            value: PhantomData,
            manifest,
        })
    }

    /// The feed account.
    pub fn address(&self) -> Pubkey {
        Pubkey::from(feed_address(self.admin.as_array(), self.program.as_array()))
    }

    /// `create_with_seed(admin, seed, loader)`.
    pub fn program(&self) -> Pubkey {
        self.program
    }

    pub fn deploy(&self) -> Deploy<'_, T> {
        Deploy { doppler: self }
    }

    /// `sequence` is any strictly increasing u64; unix milliseconds, `now_ms()`, is the convention.
    pub fn update(&self, sequence: u64, value: &T) -> Update<'_, T> {
        Update {
            doppler: self,
            sequence,
            value: *value,
        }
    }

    /// The bytes of `Update::sign`, from wherever the admin published them.
    pub fn pull(&self, signed: &[u8]) -> Result<Pull<'_, T>, Error> {
        if !self.manifest.pull {
            return Err(Error::PushOnly);
        }
        let expected = SIGNATURE + HEADER + padded(size_of::<T>());
        if signed.len() != expected {
            return Err(Error::Signed {
                expected,
                got: signed.len(),
            });
        }
        Ok(Pull {
            doppler: self,
            signed: signed.to_vec(),
        })
    }

    pub fn read(&self) -> Result<Reading<T>, Error> {
        let account = self.options.rpc.get_account(&self.address())?;
        let feed = read(
            &account.data,
            account.owner.as_array(),
            self.program.as_array(),
            size_of::<T>(),
        )?;
        Ok(Reading {
            sequence: feed.sequence,
            value: feed.value(),
        })
    }

    fn elf(&self) -> Vec<u8> {
        if self.manifest.pull {
            generate_pull(
                self.admin.as_array(),
                self.program.as_array(),
                size_of::<T>(),
            )
        } else {
            generate(self.admin.as_array(), size_of::<T>())
        }
    }

    /// What a write to the feed loads: the program, its programdata, the feed.
    fn feed_loaded_bytes(&self) -> u32 {
        3 * ACCOUNT_OVERHEAD
            + PROGRAM_ACCOUNT_LEN
            + (PROGRAMDATA_HEADER + self.elf().len()) as u32
            + (HEADER + padded(size_of::<T>())) as u32
    }

    fn budget(&self, compute_units: u32, loaded_bytes: u32, signatures: u64) -> Budget {
        let requested_compute_units = compute_units + 3 * BUILTIN_IX_CU;
        Budget {
            compute_units,
            loaded_bytes,
            requested_compute_units,
            requested_loaded_bytes: loaded_bytes
                + 2 * ACCOUNT_OVERHEAD
                + COMPUTE_BUDGET_PROGRAM_LEN,
            lamports: signatures * LAMPORTS_PER_SIGNATURE
                + priority_fee(self.options.unit_price, requested_compute_units),
        }
    }

    /// The compute budget `send` sets, then the instructions.
    fn budgeted(&self, budget: &Budget, instructions: &[Instruction]) -> Vec<Instruction> {
        let mut all = vec![
            ComputeBudgetInstruction::set_compute_unit_price(self.options.unit_price),
            ComputeBudgetInstruction::set_loaded_accounts_data_size_limit(
                budget.requested_loaded_bytes,
            ),
            ComputeBudgetInstruction::set_compute_unit_limit(budget.requested_compute_units),
        ];
        all.extend_from_slice(instructions);
        all
    }

    /// The serialized size of the transaction `send` builds around the instructions.
    fn size(&self, instructions: &[Instruction]) -> usize {
        let message = Message::new_with_blockhash(
            &self.budgeted(&self.budget(0, 0, 1), instructions),
            Some(&self.admin),
            &Hash::default(),
        );
        1 + SIGNATURE + message.serialize().len()
    }

    fn send<S: Signers + ?Sized>(
        &self,
        payer: &Pubkey,
        instructions: &[Instruction],
        signers: &S,
    ) -> Result<Signature, Error> {
        let blockhash = self.options.rpc.get_latest_blockhash()?;
        let mut tx = Transaction::new_unsigned(Message::new_with_blockhash(
            instructions,
            Some(payer),
            &blockhash,
        ));
        sign(&mut tx, signers)?;
        Ok(self.options.rpc.send_and_confirm_transaction(&tx)?)
    }
}

pub struct Update<'a, T> {
    doppler: &'a DopplerClient<'a, T>,
    sequence: u64,
    value: T,
}

impl<'a, T: Pod> Update<'a, T> {
    fn data(&self) -> Vec<u8> {
        update_data(self.sequence, doppler::bytemuck::bytes_of(&self.value))
    }

    /// The raw instruction and its budget, for your own transaction.
    pub fn instruction(&self) -> UpdateInstruction {
        let d = self.doppler;
        UpdateInstruction {
            instruction: Instruction {
                program_id: d.program,
                accounts: vec![
                    AccountMeta::new_readonly(d.admin, true),
                    AccountMeta::new(d.address(), false),
                ],
                data: self.data(),
            },
            budget: d.budget(update_cu(size_of::<T>()), d.feed_loaded_bytes(), 1),
        }
    }

    /// Exact budget, signed by the admin, who pays, confirmed.
    pub fn send<S: Signers + ?Sized>(&self, signers: &S) -> Result<Signature, Error> {
        let d = self.doppler;
        let UpdateInstruction {
            instruction,
            budget,
        } = self.instruction();
        d.send(&d.admin, &d.budgeted(&budget, &[instruction]), signers)
    }

    /// The admin's detached signature over the update, off chain: `Pull::signed` is what to
    /// publish, and `DopplerClient::pull` takes it back.
    pub fn sign(&self, admin: &dyn Signer) -> Result<Pull<'a, T>, Error> {
        let d = self.doppler;
        if !d.manifest.pull {
            return Err(Error::PushOnly);
        }
        if admin.pubkey() != d.admin {
            return Err(Error::Missing(d.admin));
        }
        let update = self.data();
        let signature = admin.try_sign_message(&pull_message(d.program.as_array(), &update))?;
        Ok(Pull {
            doppler: d,
            signed: [signature.as_ref(), &update].concat(),
        })
    }
}

/// An update the admin signed: the signature, then the sequence and the payload. Anyone sends it.
pub struct Pull<'a, T> {
    doppler: &'a DopplerClient<'a, T>,
    pub signed: Vec<u8>,
}

impl<T: Pod> Pull<'_, T> {
    /// The raw instruction and its budget, for your own transaction. One account, the feed.
    pub fn instruction(&self) -> UpdateInstruction {
        let d = self.doppler;
        UpdateInstruction {
            instruction: Instruction {
                program_id: d.program,
                accounts: vec![AccountMeta::new(d.address(), false)],
                data: self.signed.clone(),
            },
            budget: d.budget(pull_cu(size_of::<T>()), d.feed_loaded_bytes(), 1),
        }
    }

    /// Exact budget, the first signer pays, confirmed.
    pub fn send<S: Signers + ?Sized>(&self, signers: &S) -> Result<Signature, Error> {
        let d = self.doppler;
        let payer = *signers.pubkeys().first().ok_or(Error::Payer)?;
        let UpdateInstruction {
            instruction,
            budget,
        } = self.instruction();
        d.send(&payer, &d.budgeted(&budget, &[instruction]), signers)
    }
}

pub struct Deploy<'a, T> {
    doppler: &'a DopplerClient<'a, T>,
}

impl<T: Pod> Deploy<'_, T> {
    /// The raw instructions, one element per transaction, each with its budget: create and fill
    /// the buffer, create the program, deploy it immutable, create the feed. The program and the
    /// buffer are seeded accounts of the admin, so nothing but the admin signs. Writes take what
    /// a packet holds: a push program is one transaction, a pull program several.
    pub fn instructions(&self) -> Vec<DeployInstructions> {
        let d = self.doppler;
        let elf = d.elf();
        let rent = Rent::default();
        let loader = bpf_loader_upgradeable::id();
        let buffer =
            Pubkey::create_with_seed(&d.admin, BUFFER_SEED, &loader).expect("a short seed");
        let buffer_len = UpgradeableLoaderState::size_of_buffer(elf.len());
        let create = |to: &Pubkey, seed: &str, space: usize, owner: &Pubkey| {
            let ix = create_account_with_seed(
                &d.admin,
                to,
                &d.admin,
                seed,
                rent.minimum_balance(space),
                space as u64,
                owner,
            );
            (ix, BUILTIN_IX_CU)
        };
        let write = |offset: usize, bytes: &[u8]| {
            let ix = loader::write(&buffer, &d.admin, offset as u32, bytes.to_vec());
            (ix, LOADER_IX_CU)
        };
        let ixs = |costed: &[(Instruction, u32)]| -> Vec<Instruction> {
            costed.iter().map(|(ix, _)| ix.clone()).collect()
        };

        let mut transactions = vec![];
        let mut current = vec![
            create(&buffer, BUFFER_SEED, buffer_len, &loader),
            (
                loader::create_buffer(&d.admin, &buffer, &d.admin, 0, elf.len())
                    .expect("loader instruction")
                    .pop()
                    .unwrap(),
                LOADER_IX_CU,
            ),
        ];
        let mut offset = 0;
        loop {
            let rest = &elf[offset..];
            let mut probe = ixs(&current);
            probe.push(write(offset, rest).0);
            let chunk = rest.len() - d.size(&probe).saturating_sub(PACKET_DATA_SIZE);
            current.push(write(offset, &rest[..chunk]));
            offset += chunk;
            if offset == elf.len() {
                break;
            }
            transactions.push(std::mem::take(&mut current));
        }
        let space = HEADER + padded(size_of::<T>());
        let finish = [
            create(
                &d.program,
                &d.manifest.seed,
                UpgradeableLoaderState::size_of_program(),
                &loader,
            ),
            (
                loader::deploy_with_max_program_len(
                    &d.admin,
                    &d.program,
                    &buffer,
                    &d.admin,
                    0,
                    elf.len(),
                    true,
                )
                .expect("loader instruction")
                .pop()
                .unwrap(),
                LOADER_IX_CU + BUILTIN_IX_CU,
            ),
            (
                loader::set_upgrade_authority(&d.program, &d.admin, None),
                LOADER_IX_CU,
            ),
            create(&d.address(), FEED_SEED, space, &d.program),
        ];
        let mut probe = ixs(&current);
        probe.extend(ixs(&finish));
        if d.size(&probe) > PACKET_DATA_SIZE {
            transactions.push(std::mem::take(&mut current));
        }
        current.extend(finish);
        transactions.push(current);

        transactions
            .into_iter()
            .enumerate()
            .map(|(i, costed)| {
                let instructions = ixs(&costed);
                let mut keys: Vec<Pubkey> = instructions
                    .iter()
                    .flat_map(|ix| ix.accounts.iter().map(|a| a.pubkey).chain([ix.program_id]))
                    .filter(|k| *k != d.admin)
                    .collect();
                keys.sort_unstable();
                keys.dedup();
                let loaded_bytes = keys
                    .iter()
                    .map(|k| {
                        ACCOUNT_OVERHEAD
                            + if *k == buffer && i > 0 {
                                buffer_len as u32
                            } else {
                                builtin_len(k)
                            }
                    })
                    .sum();
                let compute_units = costed.iter().map(|(_, cu)| cu).sum();
                DeployInstructions {
                    instructions,
                    budget: d.budget(compute_units, loaded_bytes, 1),
                }
            })
            .collect()
    }

    /// Exact budgets, one transaction after another, each confirmed: writes the program, deploys
    /// it immutable, and creates the feed account. The admin signs and pays.
    pub fn send<S: Signers + ?Sized>(&self, signers: &S) -> Result<Vec<Signature>, Error> {
        let d = self.doppler;
        self.instructions()
            .iter()
            .map(|tx| d.send(&d.admin, &d.budgeted(&tx.budget, &tx.instructions), signers))
            .collect()
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before 1970")
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use doppler::{price_no_older_than, Field, Price, Ty};
    use solana_keypair::Keypair;

    fn manifest(fields: Vec<Field>, pull: bool) -> Manifest {
        Manifest {
            admin: Pubkey::new_unique().to_bytes(),
            seed: "SOL/USD".into(),
            pull,
            fields,
        }
    }

    fn options(rpc: &RpcClient) -> SendOptions<'_> {
        SendOptions {
            rpc,
            unit_price: 1_000,
        }
    }

    fn rpc() -> RpcClient {
        RpcClient::new("http://localhost:8899")
    }

    fn bytes(len: u16) -> Vec<Field> {
        vec![Field {
            name: "bytes".into(),
            ty: Ty::U8,
            len,
        }]
    }

    fn u64_fields() -> Vec<Field> {
        vec![Field {
            name: "price".into(),
            ty: Ty::U64,
            len: 1,
        }]
    }

    fn price_fields() -> Vec<Field> {
        vec![
            Field {
                name: "price".into(),
                ty: Ty::I64,
                len: 1,
            },
            Field {
                name: "conf".into(),
                ty: Ty::U64,
                len: 1,
            },
            Field {
                name: "expo".into(),
                ty: Ty::I32,
                len: 1,
            },
        ]
    }

    fn price() -> Price {
        Price {
            price: 17_234_000_000,
            conf: 5_000_000,
            expo: -8,
        }
    }

    #[test]
    fn load_checks_the_payload_type_against_the_schema() {
        let rpc = rpc();
        assert!(matches!(
            DopplerClient::<u32>::load(manifest(u64_fields(), false), options(&rpc)),
            Err(Error::Payload {
                manifest: 8,
                value: 4
            })
        ));
        assert!(DopplerClient::<u64>::load(manifest(u64_fields(), false), options(&rpc)).is_ok());
    }

    #[test]
    fn address_is_create_with_seed() {
        let rpc = rpc();
        let d = DopplerClient::<u64>::load(manifest(u64_fields(), false), options(&rpc)).unwrap();
        assert_eq!(
            d.program(),
            Pubkey::create_with_seed(&d.admin, "SOL/USD", &bpf_loader_upgradeable::id()).unwrap()
        );
        assert_eq!(
            d.address(),
            Pubkey::create_with_seed(&d.admin, FEED_SEED, &d.program).unwrap()
        );
    }

    #[test]
    fn one_update_is_21_cu_of_471_and_617_bytes_of_767() {
        let rpc = rpc();
        let d = DopplerClient::<u64>::load(manifest(u64_fields(), false), options(&rpc)).unwrap();
        assert_eq!(d.elf().len(), 328);
        let UpdateInstruction {
            instruction,
            budget,
        } = d.update(1, &1u64).instruction();
        assert_eq!(
            budget,
            Budget {
                compute_units: 21,
                loaded_bytes: 3 * 64 + 36 + (45 + 328) + 16,
                requested_compute_units: 471,
                requested_loaded_bytes: 5 * 64 + 22 + 36 + (45 + 328) + 16,
                lamports: 5_000 + 1,
            }
        );
        assert_eq!(d.budgeted(&budget, &[instruction]).len(), 4);
        assert_eq!(priority_fee(1_000_000, 471), 471);
        assert_eq!(priority_fee(0, 471), 0);
    }

    #[test]
    fn update_round_trips_packed_through_the_wire_format() {
        let rpc = rpc();
        let d =
            DopplerClient::<Price>::load(manifest(price_fields(), false), options(&rpc)).unwrap();
        let ix = d.update(5, &price()).instruction().instruction;
        assert_eq!(ix.accounts[1].pubkey, d.address());
        assert_eq!(ix.data.len(), HEADER + 24);
        let feed = read(&ix.data, d.program.as_array(), d.program.as_array(), 20).unwrap();
        assert_eq!(feed.value::<Price>(), price());
        assert_eq!(
            price_no_older_than(&feed, feed.sequence + 100, 100),
            Ok(price())
        );
    }

    #[test]
    fn sign_places_each_signature_where_the_message_wants_it() {
        let rpc = rpc();
        let (admin, stranger) = (Keypair::new(), Keypair::new());
        let d = DopplerClient::<Price>::load(
            Manifest {
                admin: admin.pubkey().to_bytes(),
                seed: "SOL/USD".into(),
                pull: false,
                fields: price_fields(),
            },
            options(&rpc),
        )
        .unwrap();
        let instructions = &d.deploy().instructions()[0].instructions;
        let unsigned = |ixs: &[Instruction]| {
            Transaction::new_unsigned(Message::new_with_blockhash(
                ixs,
                Some(&d.admin),
                &Default::default(),
            ))
        };
        let mut deploy = unsigned(instructions);
        sign(&mut deploy, &[&admin, &stranger]).unwrap();
        assert!(deploy.is_signed());
        let mut lacking = unsigned(instructions);
        assert!(
            matches!(sign(&mut lacking, &[&stranger]), Err(Error::Missing(k)) if k == admin.pubkey())
        );
        let mut update = unsigned(&[d.update(1, &price()).instruction().instruction]);
        assert!(
            matches!(sign(&mut update, &[&stranger]), Err(Error::Missing(k)) if k == admin.pubkey())
        );
    }

    #[test]
    fn a_push_deploy_is_one_transaction_for_every_payload_size_and_ends_immutable_with_the_feed() {
        let rpc = rpc();
        let d =
            DopplerClient::<Price>::load(manifest(price_fields(), false), options(&rpc)).unwrap();
        let deploy = d.deploy().instructions();
        assert_eq!(deploy.len(), 1);
        let DeployInstructions {
            instructions,
            budget,
        } = &deploy[0];
        assert_eq!(instructions.len(), 7);
        assert_eq!(instructions[5].accounts.len(), 2);
        assert_eq!(instructions[6].accounts[1].pubkey, d.address());
        assert_eq!(
            *budget,
            Budget {
                compute_units: 10_080,
                loaded_bytes: 8 * 64 + 21 + 37 + 17 + 40,
                requested_compute_units: 10_530,
                requested_loaded_bytes: 10 * 64 + 21 + 37 + 17 + 40 + 22,
                lamports: 5_000 + 11,
            }
        );
        assert!(d.size(instructions) <= PACKET_DATA_SIZE);
        let one = DopplerClient::<[u8; 1]>::load(manifest(bytes(1), false), options(&rpc)).unwrap();
        assert_eq!(one.deploy().instructions().len(), 1);
        let inline =
            DopplerClient::<[u8; 40]>::load(manifest(bytes(40), false), options(&rpc)).unwrap();
        assert_eq!(inline.elf().len(), 392);
        assert_eq!(inline.deploy().instructions().len(), 1);
        let memcpy =
            DopplerClient::<[u8; 64]>::load(manifest(bytes(64), false), options(&rpc)).unwrap();
        assert_eq!(memcpy.elf().len(), 336);
        assert_eq!(memcpy.deploy().instructions().len(), 1);
    }

    #[test]
    fn a_pull_deploy_fills_packets_and_finishes_in_the_last() {
        let rpc = rpc();
        let d =
            DopplerClient::<Price>::load(manifest(price_fields(), true), options(&rpc)).unwrap();
        let elf = d.elf();
        let deploy = d.deploy().instructions();
        let last = deploy.len() - 1;
        assert_eq!(elf.len(), 19_152);
        assert_eq!(last, 20, "a packet holds up to 964 bytes of program");
        let mut offset = 0;
        for (i, tx) in deploy.iter().enumerate() {
            assert!(
                d.size(&tx.instructions) <= PACKET_DATA_SIZE,
                "transaction {i}"
            );
            for ix in &tx.instructions {
                if ix.program_id == bpf_loader_upgradeable::id() && ix.data[..4] == [1, 0, 0, 0] {
                    assert_eq!(
                        u32::from_le_bytes(ix.data[4..8].try_into().unwrap()) as usize,
                        offset
                    );
                    let len = u64::from_le_bytes(ix.data[8..16].try_into().unwrap()) as usize;
                    assert_eq!(ix.data[16..], elf[offset..offset + len]);
                    offset += len;
                }
            }
        }
        assert_eq!(offset, elf.len());
        assert_eq!(deploy[0].instructions.len(), 3);
        assert_eq!(deploy[1].instructions.len(), 1);
        assert!(deploy[1].instructions[0].data.len() > deploy[0].instructions[2].data.len());
        assert_eq!(deploy[last].instructions.len(), 5);
        assert_eq!(deploy[last].instructions[4].accounts[1].pubkey, d.address());
        assert_eq!(deploy[0].budget.compute_units, 150 + 2 * 2_370);
        assert_eq!(deploy[0].budget.loaded_bytes, 3 * 64 + 21 + 37);
        assert_eq!(deploy[1].budget.compute_units, 2_370);
        assert_eq!(
            deploy[1].budget.loaded_bytes,
            2 * 64 + (37 + elf.len() as u32) + 37
        );
        assert_eq!(
            deploy[last].budget.compute_units,
            2_370 + 2 * 150 + 2 * 2_370 + 150
        );
        assert_eq!(
            deploy[last].budget.loaded_bytes,
            8 * 64 + (37 + elf.len() as u32) + 21 + 37 + 17 + 40
        );
        assert!(d.size(&deploy[last - 1].instructions) > PACKET_DATA_SIZE - 32);
    }

    #[test]
    fn a_signed_update_verifies_against_the_admin_and_comes_back_as_a_pull() {
        let rpc = rpc();
        let admin = Keypair::new();
        let d = DopplerClient::<Price>::load(
            Manifest {
                admin: admin.pubkey().to_bytes(),
                seed: "SOL/USD".into(),
                pull: true,
                fields: price_fields(),
            },
            options(&rpc),
        )
        .unwrap();
        let update = d.update(5, &price());
        let signed = update.sign(&admin).unwrap().signed;
        assert_eq!(signed.len(), 64 + 8 + 24);
        assert_eq!(signed[64..], update.data());
        let signature = Signature::try_from(&signed[..64]).unwrap();
        assert!(signature.verify(
            &admin.pubkey().to_bytes(),
            &pull_message(d.program.as_array(), &signed[64..])
        ));
        assert!(
            matches!(update.sign(&Keypair::new()), Err(Error::Missing(k)) if k == admin.pubkey())
        );

        let UpdateInstruction {
            instruction,
            budget,
        } = d.pull(&signed).unwrap().instruction();
        assert_eq!(instruction.accounts.len(), 1);
        assert_eq!(instruction.accounts[0].pubkey, d.address());
        assert_eq!(instruction.data, signed);
        assert_eq!(budget.compute_units, pull_cu(20));
        assert_eq!(
            budget.loaded_bytes,
            3 * 64 + 36 + (45 + d.elf().len() as u32) + 32
        );
        assert_eq!(budget.requested_compute_units, pull_cu(20) + 450);
        assert!(matches!(
            d.pull(&signed[1..]),
            Err(Error::Signed {
                expected: 96,
                got: 95
            })
        ));
        assert!(matches!(
            d.pull(&signed).unwrap().send(&[] as &[&Keypair; 0]),
            Err(Error::Payer)
        ));

        let push =
            DopplerClient::<Price>::load(manifest(price_fields(), false), options(&rpc)).unwrap();
        assert!(matches!(
            push.update(5, &price()).sign(&admin),
            Err(Error::PushOnly)
        ));
        assert!(matches!(push.pull(&signed), Err(Error::PushOnly)));
    }
}
