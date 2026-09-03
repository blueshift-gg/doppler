//! Rust client for Doppler feeds: `load` a manifest, `deploy` once, then `update` and `read`.

use std::{
    fmt,
    marker::PhantomData,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub use doppler;
use doppler::{
    feed_address, generate, layout, read, update_cu, update_data, Manifest, Pod, FEED_SEED, HEADER,
    PROGRAMDATA_HEADER,
};
use solana_client::{client_error::ClientError, rpc_client::RpcClient};
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_loader_v3_interface::{instruction as loader, state::UpgradeableLoaderState};
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_rent::Rent;
use solana_signature::Signature;
use solana_signer::{signers::Signers, Signer, SignerError};
use solana_system_interface::instruction::create_account_with_seed;
use solana_transaction::Transaction;

/// `DEFAULT_COMPUTE_UNITS` of the compute-budget builtin.
const BUILTIN_IX_CU: u32 = 150;
/// SIMD-0186.
const ACCOUNT_OVERHEAD: u32 = 64;
/// Loader-v3 program account: tag, programdata address.
const PROGRAM_ACCOUNT_LEN: u32 = 4 + 32;
/// `solana_packet::PACKET_DATA_SIZE`.
const PACKET_DATA_SIZE: usize = 1232;

#[derive(Debug)]
pub enum Error {
    Io(std::io::Error),
    Manifest(serde_json::Error),
    Doppler(doppler::Error),
    Rpc(ClientError),
    Payload { manifest: usize, value: usize },
    Missing(Pubkey),
    Sign(SignerError),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Io(e) => write!(f, "manifest: {e}"),
            Error::Manifest(e) => write!(f, "manifest: {e}"),
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

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Manifest(e)
    }
}

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
fn sign<S: Signers + ?Sized>(
    tx: &mut Transaction,
    signers: &S,
    extra: Option<&Keypair>,
) -> Result<(), Error> {
    let message = tx.message_data();
    let mut keys = signers.pubkeys();
    let mut signatures = signers.try_sign_message(&message)?;
    if let Some(keypair) = extra {
        keys.push(keypair.pubkey());
        signatures.push(keypair.sign_message(&message));
    }
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

fn expect<S: Signers + ?Sized>(signers: &S, key: Pubkey) -> Result<(), Error> {
    if signers.pubkeys().contains(&key) {
        Ok(())
    } else {
        Err(Error::Missing(key))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Reading<T> {
    pub last_updated_ms: u64,
    pub value: T,
}

/// One program, one admin, one payload type, one feed account.
pub struct Doppler<T> {
    pub manifest: Manifest,
    program: Pubkey,
    admin: Pubkey,
    value: PhantomData<T>,
}

impl<T: Pod> Doppler<T> {
    pub fn load(manifest: impl AsRef<Path>) -> Result<Self, Error> {
        Self::from_manifest(std::fs::read_to_string(manifest)?.parse()?)
    }

    pub fn from_manifest(manifest: Manifest) -> Result<Self, Error> {
        let size = layout(&manifest.fields)?.size;
        if size != size_of::<T>() {
            return Err(Error::Payload {
                manifest: size,
                value: size_of::<T>(),
            });
        }
        Ok(Self {
            program: Pubkey::from(manifest.program),
            admin: Pubkey::from(manifest.admin),
            value: PhantomData,
            manifest,
        })
    }

    /// The feed account.
    pub fn address(&self) -> Pubkey {
        Pubkey::from(feed_address(self.admin.as_array(), self.program.as_array()))
    }

    pub fn deploy(&self) -> Deploy<'_, T> {
        Deploy { doppler: self }
    }

    pub fn update(&self, value: &T) -> Update<'_, T> {
        Update {
            doppler: self,
            last_updated_ms: now_ms(),
            value: *value,
        }
    }

    pub fn read(&self, rpc: &RpcClient) -> Result<Reading<T>, Error> {
        let account = rpc.get_account(&self.address())?;
        let feed = read(
            &account.data,
            account.owner.as_array(),
            self.program.as_array(),
            size_of::<T>(),
        )?;
        Ok(Reading {
            last_updated_ms: feed.last_updated_ms,
            value: feed.value(),
        })
    }

    fn elf(&self) -> Vec<u8> {
        generate(self.admin.as_array(), size_of::<T>())
    }

    /// Compute units and loaded bytes of one update: the admin, the compute-budget program, the
    /// program, its exact-fit programdata, and the feed.
    fn budget(&self) -> (u32, u32) {
        let programdata = (PROGRAMDATA_HEADER + self.elf().len()) as u32;
        let feed = (HEADER + size_of::<T>()) as u32;
        let loaded = 5 * ACCOUNT_OVERHEAD
            + "compute_budget_program".len() as u32
            + PROGRAM_ACCOUNT_LEN
            + programdata
            + feed;
        (3 * BUILTIN_IX_CU + update_cu(size_of::<T>()), loaded)
    }
}

pub struct Update<'a, T> {
    doppler: &'a Doppler<T>,
    last_updated_ms: u64,
    value: T,
}

impl<T: Pod> Update<'_, T> {
    pub fn at(mut self, last_updated_ms: u64) -> Self {
        self.last_updated_ms = last_updated_ms;
        self
    }

    /// The raw instruction, for your own transaction and budget. The admin signs.
    pub fn instruction(&self) -> Instruction {
        let d = self.doppler;
        Instruction {
            program_id: d.program,
            accounts: vec![
                AccountMeta::new_readonly(d.admin, true),
                AccountMeta::new(d.address(), false),
            ],
            data: update_data(
                self.last_updated_ms,
                doppler::bytemuck::bytes_of(&self.value),
            ),
        }
    }

    /// The compute-budget instructions and the update, for a transaction that holds only this update.
    /// `unit_price` is micro-lamports per compute unit.
    pub fn instructions(&self, unit_price: u64) -> [Instruction; 4] {
        let (compute_units, loaded_bytes) = self.doppler.budget();
        [
            ComputeBudgetInstruction::set_compute_unit_price(unit_price),
            ComputeBudgetInstruction::set_loaded_accounts_data_size_limit(loaded_bytes),
            ComputeBudgetInstruction::set_compute_unit_limit(compute_units),
            self.instruction(),
        ]
    }

    /// Exact budget, signed by the admin, who pays, confirmed.
    pub fn send<S: Signers + ?Sized>(
        &self,
        signers: &S,
        rpc: &RpcClient,
        unit_price: u64,
    ) -> Result<Signature, Error> {
        let d = self.doppler;
        expect(signers, d.admin)?;
        let blockhash = rpc.get_latest_blockhash()?;
        let mut tx = Transaction::new_unsigned(Message::new_with_blockhash(
            &self.instructions(unit_price),
            Some(&d.admin),
            &blockhash,
        ));
        sign(&mut tx, signers, None)?;
        Ok(rpc.send_and_confirm_transaction(&tx)?)
    }
}

pub struct Deploy<'a, T> {
    doppler: &'a Doppler<T>,
}

impl<T: Pod> Deploy<'_, T> {
    /// Writes the program, deploys it immutable, and creates the feed account, in one transaction
    /// when it fits. `signers` are the admin, who pays, and the program keypair, needed only here.
    pub fn send<S: Signers + ?Sized>(
        &self,
        signers: &S,
        rpc: &RpcClient,
    ) -> Result<Signature, Error> {
        let d = self.doppler;
        expect(signers, d.admin)?;
        expect(signers, d.program)?;
        let buffer = Keypair::new();
        let blockhash = rpc.get_latest_blockhash()?;
        let [write, deploy] = self.instructions(&buffer.pubkey());
        let unsigned = |instructions: &[Instruction]| {
            Transaction::new_unsigned(Message::new_with_blockhash(
                instructions,
                Some(&d.admin),
                &blockhash,
            ))
        };
        let mut single = unsigned(&[write.as_slice(), deploy.as_slice()].concat());
        if 1 + 64 * single.signatures.len() + single.message_data().len() <= PACKET_DATA_SIZE {
            sign(&mut single, signers, Some(&buffer))?;
            return Ok(rpc.send_and_confirm_transaction(&single)?);
        }
        let mut first = unsigned(&write);
        sign(&mut first, signers, Some(&buffer))?;
        rpc.send_and_confirm_transaction(&first)?;
        let mut second = unsigned(&deploy);
        sign(&mut second, signers, None)?;
        Ok(rpc.send_and_confirm_transaction(&second)?)
    }

    /// `[buffer create + write, program create + deploy + finalize + feed create]`.
    fn instructions(&self, buffer: &Pubkey) -> [Vec<Instruction>; 2] {
        let d = self.doppler;
        let elf = d.elf();
        let rent = Rent::default();
        let mut write = loader::create_buffer(
            &d.admin,
            buffer,
            &d.admin,
            rent.minimum_balance(UpgradeableLoaderState::size_of_buffer(elf.len())),
            elf.len(),
        )
        .expect("loader instruction");
        write.push(loader::write(buffer, &d.admin, 0, elf.clone()));
        let mut deploy = loader::deploy_with_max_program_len(
            &d.admin,
            &d.program,
            buffer,
            &d.admin,
            rent.minimum_balance(UpgradeableLoaderState::size_of_program()),
            elf.len(),
            true,
        )
        .expect("loader instruction");
        deploy.push(loader::set_upgrade_authority(&d.program, &d.admin, None));
        let space = HEADER + size_of::<T>();
        deploy.push(create_account_with_seed(
            &d.admin,
            &d.address(),
            &d.admin,
            FEED_SEED,
            rent.minimum_balance(space),
            space as u64,
            &d.program,
        ));
        [write, deploy]
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

    fn manifest(fields: Vec<Field>) -> Manifest {
        Manifest {
            program: Pubkey::new_unique().to_bytes(),
            admin: Pubkey::new_unique().to_bytes(),
            fields,
        }
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
        assert!(matches!(
            Doppler::<u32>::from_manifest(manifest(u64_fields())),
            Err(Error::Payload {
                manifest: 8,
                value: 4
            })
        ));
        assert!(Doppler::<u64>::from_manifest(manifest(u64_fields())).is_ok());
    }

    #[test]
    fn address_is_create_with_seed() {
        let d = Doppler::<u64>::from_manifest(manifest(u64_fields())).unwrap();
        assert_eq!(
            d.address(),
            Pubkey::create_with_seed(&d.admin, FEED_SEED, &d.program).unwrap()
        );
    }

    #[test]
    fn one_update_is_471_cu_and_767_bytes() {
        let d = Doppler::<u64>::from_manifest(manifest(u64_fields())).unwrap();
        assert_eq!(d.elf().len(), 328);
        assert_eq!(d.budget(), (471, 5 * 64 + 22 + 36 + (45 + 328) + 16));
        assert_eq!(d.update(&1u64).instructions(1_000).len(), 4);
    }

    #[test]
    fn update_round_trips_packed_through_the_wire_format() {
        let d = Doppler::<Price>::from_manifest(manifest(price_fields())).unwrap();
        let price = Price {
            price: 17_234_000_000,
            conf: 5_000_000,
            expo: -8,
        };
        let ix = d.update(&price).at(5).instruction();
        assert_eq!(ix.accounts[1].pubkey, d.address());
        assert_eq!(ix.data.len(), HEADER + 20);
        let feed = read(&ix.data, d.program.as_array(), d.program.as_array(), 20).unwrap();
        assert_eq!(feed.value::<Price>(), price);
        assert_eq!(price_no_older_than(&feed, 105, 100), Ok(price));
    }

    #[test]
    fn sign_places_each_signature_where_the_message_wants_it() {
        let (admin, program, buffer, stranger) = (
            Keypair::new(),
            Keypair::new(),
            Keypair::new(),
            Keypair::new(),
        );
        let d = Doppler::<Price>::from_manifest(Manifest {
            program: program.pubkey().to_bytes(),
            admin: admin.pubkey().to_bytes(),
            fields: price_fields(),
        })
        .unwrap();
        let [write, deploy] = d.deploy().instructions(&buffer.pubkey());
        let unsigned = |ixs: &[Instruction]| {
            Transaction::new_unsigned(Message::new_with_blockhash(
                ixs,
                Some(&d.admin),
                &Default::default(),
            ))
        };
        let mut first = unsigned(&write);
        sign(&mut first, &[&admin, &program, &stranger], Some(&buffer)).unwrap();
        assert!(first.is_signed());
        let mut second = unsigned(&deploy);
        sign(&mut second, &[&admin, &program], Some(&buffer)).unwrap();
        assert!(second.is_signed());
        let mut lacking = unsigned(&deploy);
        assert!(
            matches!(sign(&mut lacking, &[&admin], Some(&buffer)), Err(Error::Missing(k)) if k == program.pubkey())
        );
        let mut update = unsigned(&[d
            .update(&Price {
                price: 1,
                conf: 1,
                expo: 0,
            })
            .instruction()]);
        assert!(
            matches!(sign(&mut update, &[&stranger], None), Err(Error::Missing(k)) if k == admin.pubkey())
        );
    }

    #[test]
    fn deploy_fits_one_transaction_and_ends_immutable_with_the_feed() {
        let d = Doppler::<Price>::from_manifest(manifest(price_fields())).unwrap();
        let [write, deploy] = d.deploy().instructions(&Pubkey::new_unique());
        assert_eq!((write.len(), deploy.len()), (3, 4));
        assert_eq!(deploy[3].accounts[1].pubkey, d.address());
        let all = [write, deploy].concat();
        let tx = Transaction::new_unsigned(Message::new_with_blockhash(
            &all,
            Some(&d.admin),
            &Default::default(),
        ));
        let size = 1 + 64 * 3 + tx.message_data().len();
        assert!(size <= PACKET_DATA_SIZE, "{size}");
    }
}
