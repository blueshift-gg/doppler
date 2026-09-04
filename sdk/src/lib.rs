//! Rust client for Doppler feeds: `load` a manifest, `deploy` once, then `update` and `read`.

use std::{
    fmt,
    marker::PhantomData,
    time::{SystemTime, UNIX_EPOCH},
};

pub use doppler;
use doppler::{
    feed_address, generate, padded, payload_size, program_address, read, update_cu, update_data,
    Manifest, Pod, FEED_SEED, HEADER, PROGRAMDATA_HEADER,
};
use solana_client::{client_error::ClientError, rpc_client::RpcClient};
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_instruction::{AccountMeta, Instruction};
use solana_loader_v3_interface::{instruction as loader, state::UpgradeableLoaderState};
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_rent::Rent;
use solana_sdk_ids::bpf_loader_upgradeable;
use solana_signature::Signature;
use solana_signer::{signers::Signers, SignerError};
use solana_system_interface::instruction::create_account_with_seed;
use solana_transaction::Transaction;

/// `DEFAULT_COMPUTE_UNITS` of the system and compute-budget builtins.
const BUILTIN_IX_CU: u32 = 150;
/// A deploy's own units: three `create_account`s, the loader's `create_account` CPI, and four
/// loader-v3 instructions at 2_370 each. Measured at 10_230 with the price instruction on surfpool
/// 1.5.0 for 328, 336 and 360-byte programs; pinned by the live tests.
const DEPLOY_CU: u32 = 4 * BUILTIN_IX_CU + 4 * 2_370;
/// SIMD-0186.
const ACCOUNT_OVERHEAD: u32 = 64;
const COMPUTE_BUDGET_PROGRAM_LEN: u32 = "compute_budget_program".len() as u32;
/// Builtin and sysvar data a deploy loads: the system program, 21 bytes on mainnet and 14 on devnet,
/// where a limit only needs to cover the larger; the loader; the rent and clock sysvars.
const DEPLOY_LOADED_DATA: u32 = 21 + 37 + 17 + 40;
/// Loader-v3 program account: tag, programdata address.
const PROGRAM_ACCOUNT_LEN: u32 = 4 + 32;
/// The buffer lives only inside the deploy transaction, so one seed serves every deploy.
const BUFFER_SEED: &str = "buf";
/// `FeeStructure::default()`.
const LAMPORTS_PER_SIGNATURE: u64 = 5_000;

#[derive(Debug)]
pub enum Error {
    Doppler(doppler::Error),
    Rpc(ClientError),
    Payload { manifest: usize, value: usize },
    Missing(Pubkey),
    Sign(SignerError),
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

/// The raw update instruction, which the admin signs, and its budget.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateInstruction {
    pub instruction: Instruction,
    pub budget: Budget,
}

/// The raw deploy instructions and their budget: create and fill the buffer, create the program,
/// deploy it immutable, create the feed. The admin pays and is the only signer.
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
        generate(self.admin.as_array(), size_of::<T>())
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

    fn send<S: Signers + ?Sized>(
        &self,
        instructions: &[Instruction],
        signers: &S,
    ) -> Result<Signature, Error> {
        let blockhash = self.options.rpc.get_latest_blockhash()?;
        let mut tx = Transaction::new_unsigned(Message::new_with_blockhash(
            instructions,
            Some(&self.admin),
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

impl<T: Pod> Update<'_, T> {
    /// The raw instruction and its budget, for your own transaction.
    pub fn instruction(&self) -> UpdateInstruction {
        let d = self.doppler;
        let loaded_bytes = 3 * ACCOUNT_OVERHEAD
            + PROGRAM_ACCOUNT_LEN
            + (PROGRAMDATA_HEADER + d.elf().len()) as u32
            + (HEADER + padded(size_of::<T>())) as u32;
        UpdateInstruction {
            instruction: Instruction {
                program_id: d.program,
                accounts: vec![
                    AccountMeta::new_readonly(d.admin, true),
                    AccountMeta::new(d.address(), false),
                ],
                data: update_data(self.sequence, doppler::bytemuck::bytes_of(&self.value)),
            },
            budget: d.budget(update_cu(size_of::<T>()), loaded_bytes, 1),
        }
    }

    /// Exact budget, signed by the admin, who pays, confirmed.
    pub fn send<S: Signers + ?Sized>(&self, signers: &S) -> Result<Signature, Error> {
        let d = self.doppler;
        let UpdateInstruction {
            instruction,
            budget,
        } = self.instruction();
        d.send(&d.budgeted(&budget, &[instruction]), signers)
    }
}

pub struct Deploy<'a, T> {
    doppler: &'a DopplerClient<'a, T>,
}

impl<T: Pod> Deploy<'_, T> {
    /// The raw instructions and their budget, for your own transaction. The program and the buffer
    /// are seeded accounts of the admin, so nothing but the admin signs.
    pub fn instructions(&self) -> DeployInstructions {
        let d = self.doppler;
        let elf = d.elf();
        let rent = Rent::default();
        let loader = bpf_loader_upgradeable::id();
        let buffer =
            Pubkey::create_with_seed(&d.admin, BUFFER_SEED, &loader).expect("a short seed");
        let buffer_len = UpgradeableLoaderState::size_of_buffer(elf.len());
        let mut instructions = vec![create_account_with_seed(
            &d.admin,
            &buffer,
            &d.admin,
            BUFFER_SEED,
            rent.minimum_balance(buffer_len),
            buffer_len as u64,
            &loader,
        )];
        instructions.extend(
            loader::create_buffer(&d.admin, &buffer, &d.admin, 0, elf.len())
                .expect("loader instruction")
                .pop(),
        );
        instructions.push(loader::write(&buffer, &d.admin, 0, elf.clone()));
        let program_len = UpgradeableLoaderState::size_of_program();
        instructions.push(create_account_with_seed(
            &d.admin,
            &d.program,
            &d.admin,
            &d.manifest.seed,
            rent.minimum_balance(program_len),
            program_len as u64,
            &loader,
        ));
        instructions.extend(
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
            .pop(),
        );
        instructions.push(loader::set_upgrade_authority(&d.program, &d.admin, None));
        let space = HEADER + padded(size_of::<T>());
        instructions.push(create_account_with_seed(
            &d.admin,
            &d.address(),
            &d.admin,
            FEED_SEED,
            rent.minimum_balance(space),
            space as u64,
            &d.program,
        ));
        DeployInstructions {
            instructions,
            budget: d.budget(DEPLOY_CU, 8 * ACCOUNT_OVERHEAD + DEPLOY_LOADED_DATA, 1),
        }
    }

    /// Exact budget, one transaction: writes the program, deploys it immutable, and creates the
    /// feed account. The admin signs and pays.
    pub fn send<S: Signers + ?Sized>(&self, signers: &S) -> Result<Signature, Error> {
        let d = self.doppler;
        let DeployInstructions {
            instructions,
            budget,
        } = self.instructions();
        d.send(&d.budgeted(&budget, &instructions), signers)
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
    use solana_signer::Signer;

    /// `solana_packet::PACKET_DATA_SIZE`.
    const PACKET_DATA_SIZE: usize = 1232;

    fn manifest(fields: Vec<Field>) -> Manifest {
        Manifest {
            admin: Pubkey::new_unique().to_bytes(),
            seed: "SOL/USD".into(),
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

    #[test]
    fn load_checks_the_payload_type_against_the_schema() {
        let rpc = rpc();
        assert!(matches!(
            DopplerClient::<u32>::load(manifest(u64_fields()), options(&rpc)),
            Err(Error::Payload {
                manifest: 8,
                value: 4
            })
        ));
        assert!(DopplerClient::<u64>::load(manifest(u64_fields()), options(&rpc)).is_ok());
    }

    #[test]
    fn address_is_create_with_seed() {
        let rpc = rpc();
        let d = DopplerClient::<u64>::load(manifest(u64_fields()), options(&rpc)).unwrap();
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
        let d = DopplerClient::<u64>::load(manifest(u64_fields()), options(&rpc)).unwrap();
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
        let d = DopplerClient::<Price>::load(manifest(price_fields()), options(&rpc)).unwrap();
        let price = Price {
            price: 17_234_000_000,
            conf: 5_000_000,
            expo: -8,
        };
        let ix = d.update(5, &price).instruction().instruction;
        assert_eq!(ix.accounts[1].pubkey, d.address());
        assert_eq!(ix.data.len(), HEADER + 24);
        let feed = read(&ix.data, d.program.as_array(), d.program.as_array(), 20).unwrap();
        assert_eq!(feed.value::<Price>(), price);
        assert_eq!(
            price_no_older_than(&feed, feed.sequence + 100, 100),
            Ok(price)
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
                fields: price_fields(),
            },
            options(&rpc),
        )
        .unwrap();
        let DeployInstructions { instructions, .. } = d.deploy().instructions();
        let unsigned = |ixs: &[Instruction]| {
            Transaction::new_unsigned(Message::new_with_blockhash(
                ixs,
                Some(&d.admin),
                &Default::default(),
            ))
        };
        let mut deploy = unsigned(&instructions);
        sign(&mut deploy, &[&admin, &stranger]).unwrap();
        assert!(deploy.is_signed());
        let mut lacking = unsigned(&instructions);
        assert!(
            matches!(sign(&mut lacking, &[&stranger]), Err(Error::Missing(k)) if k == admin.pubkey())
        );
        let mut update = unsigned(&[d
            .update(
                1,
                &Price {
                    price: 1,
                    conf: 1,
                    expo: 0,
                },
            )
            .instruction()
            .instruction]);
        assert!(
            matches!(sign(&mut update, &[&stranger]), Err(Error::Missing(k)) if k == admin.pubkey())
        );
    }

    #[test]
    fn deploy_fits_one_transaction_for_every_payload_size_and_ends_immutable_with_the_feed() {
        let rpc = rpc();
        let d = DopplerClient::<Price>::load(manifest(price_fields()), options(&rpc)).unwrap();
        let DeployInstructions {
            instructions,
            budget,
            ..
        } = d.deploy().instructions();
        assert_eq!(instructions.len(), 7);
        assert_eq!(instructions[5].accounts.len(), 2);
        assert_eq!(instructions[6].accounts[1].pubkey, d.address());
        assert_eq!(
            budget,
            Budget {
                compute_units: 10_080,
                loaded_bytes: 8 * 64 + 21 + 37 + 17 + 40,
                requested_compute_units: 10_530,
                requested_loaded_bytes: 10 * 64 + 21 + 37 + 17 + 40 + 22,
                lamports: 5_000 + 11,
            }
        );
        let tx = Transaction::new_unsigned(Message::new_with_blockhash(
            &d.budgeted(&budget, &instructions),
            Some(&d.admin),
            &Default::default(),
        ));
        let largest = (1..=64)
            .map(|n| generate(d.admin.as_array(), n).len())
            .max()
            .unwrap();
        let size = 1 + 64 + tx.message_data().len() + largest - d.elf().len();
        assert!(size <= PACKET_DATA_SIZE, "{size}");
    }
}
