// @solana/kit client for Doppler feeds: `load` a manifest, `deploy` once, then `update`, `read`, `subscribe`.

import { BUFFER_HEADER, FEED_SEED, Feed, HEADER, PROGRAM_LEN, rentExempt } from '../../core/index.js';
import type { Field, FieldLike, Manifest, Payload, Reading } from '../../core/index.js';
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  fetchEncodedAccount,
  generateKeyPairSigner,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  isTransactionWithinSizeLimit,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from '@solana/kit';
import type {
  AccountNotificationsApi,
  Address,
  Blockhash,
  GetAccountInfoApi,
  GetBlockHeightApi,
  GetLatestBlockhashApi,
  GetSignatureStatusesApi,
  Instruction,
  Rpc,
  RpcSubscriptions,
  SendTransactionApi,
  Signature,
  TransactionSigner,
} from '@solana/kit';
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
  getSetLoadedAccountsDataSizeLimitInstruction,
} from '@solana-program/compute-budget';
import {
  LOADER_V3_PROGRAM_ADDRESS,
  getDeployWithMaxDataLenInstruction,
  getInitializeBufferInstruction,
  getSetAuthorityInstruction,
  getWriteInstruction,
} from '@solana-program/loader-v3';
import { getCreateAccountInstruction, getCreateAccountWithSeedInstruction } from '@solana-program/system';

export type { Feed, Field, FieldLike, Manifest, Payload, Reading, Ty } from '../../core/index.js';

export type SendRpc = Rpc<GetLatestBlockhashApi & SendTransactionApi & GetSignatureStatusesApi & GetBlockHeightApi>;
/** `unitPrice` is the priority fee in micro-lamports per compute unit. */
export type SendOptions = { rpc: SendRpc; unitPrice: number | bigint };

type Lifetime = { blockhash: Blockhash; lastValidBlockHeight: bigint };

function expect(signers: readonly TransactionSigner[], key: Address): TransactionSigner {
  const signer = signers.find((s) => s.address === key);
  if (!signer) throw new Error(`${key} must sign`);
  return signer;
}

/** The loader takes any third account as the new authority; the generated client fills the omitted one with its own address. */
function immutable<T extends Instruction>(setAuthority: T): T {
  return { ...setAuthority, accounts: setAuthority.accounts?.slice(0, 2) };
}

function message(payer: TransactionSigner, lifetime: Lifetime, instructions: readonly Instruction[]) {
  return pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
}

async function send(rpc: SendRpc, transactionMessage: ReturnType<typeof message>): Promise<Signature> {
  const transaction = await signTransactionMessageWithSigners(transactionMessage);
  const signature = getSignatureFromTransaction(transaction);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(transaction), { encoding: 'base64' }).send();
  for (;;) {
    const { value: [status] } = await rpc.getSignatureStatuses([signature]).send();
    if (status?.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return signature;
    if ((await rpc.getBlockHeight().send()) > transactionMessage.lifetimeConstraint.lastValidBlockHeight) {
      throw new Error(`transaction ${signature} expired`);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

/** One program, one admin, one payload layout, one feed account. */
export class Doppler<F extends readonly FieldLike[] = readonly Field[]> {
  readonly program: Address;
  readonly admin: Address;
  /** The feed account. */
  readonly address: Address;

  private constructor(readonly feed: Feed<F>) {
    this.program = address(feed.program);
    this.admin = address(feed.admin);
    this.address = address(feed.address);
  }

  static async load<const F extends readonly FieldLike[]>(manifest: Manifest<F>): Promise<Doppler<F>> {
    return new Doppler(await Feed.load(manifest));
  }

  get manifest(): Manifest<F> {
    return this.feed.manifest;
  }

  deploy(): Deploy<F> {
    return new Deploy(this);
  }

  /** `sequence` is unix milliseconds by default; any strictly increasing integer works. */
  update(value: Payload<F>, sequence: number = Date.now()): Update<F> {
    return new Update(this, sequence, value);
  }

  async read(rpc: Rpc<GetAccountInfoApi>): Promise<Reading<Payload<F>>> {
    const account = await fetchEncodedAccount(rpc, this.address);
    if (!account.exists) throw new Error(`no feed account at ${this.address}`);
    return this.feed.decode(account.data, account.programAddress);
  }

  /** Every confirmed write to the feed, until `signal` aborts or the loop breaks. */
  async *subscribe(
    rpcSubscriptions: RpcSubscriptions<AccountNotificationsApi>,
    { signal }: { signal?: AbortSignal } = {},
  ): AsyncGenerator<Reading<Payload<F>>> {
    const controller = new AbortController();
    const notifications = await rpcSubscriptions
      .accountNotifications(this.address, { encoding: 'base64' })
      .subscribe({ abortSignal: signal ?? controller.signal });
    try {
      for await (const { value } of notifications) {
        yield this.feed.decode(getBase64Encoder().encode(value.data[0]), value.owner);
      }
    } finally {
      controller.abort();
    }
  }
}

export class Update<F extends readonly FieldLike[]> {
  constructor(
    private readonly doppler: Doppler<F>,
    readonly sequence: number,
    readonly value: Payload<F>,
  ) {}

  /** The raw instruction, for your own transaction and budget. The admin signs. */
  instruction(): Instruction {
    const d = this.doppler;
    return {
      programAddress: d.program,
      accounts: [
        { address: d.admin, role: AccountRole.READONLY_SIGNER },
        { address: d.address, role: AccountRole.WRITABLE },
      ],
      data: d.feed.encode(this.sequence, this.value),
    };
  }

  /** The compute-budget instructions and the update, for a transaction that holds only this update. */
  instructions({ unitPrice }: { unitPrice: number | bigint }): Instruction[] {
    const { computeUnits, loadedBytes } = this.doppler.feed.budget();
    return [
      getSetComputeUnitPriceInstruction({ microLamports: unitPrice }),
      getSetLoadedAccountsDataSizeLimitInstruction({ accountDataSizeLimit: loadedBytes }),
      getSetComputeUnitLimitInstruction({ units: computeUnits }),
      this.instruction(),
    ];
  }

  /** Exact budget, signed by the admin, who pays, confirmed. */
  async send(signers: readonly TransactionSigner[], { rpc, unitPrice }: SendOptions): Promise<Signature> {
    const admin = expect(signers, this.doppler.admin);
    const { value: lifetime } = await rpc.getLatestBlockhash().send();
    return send(rpc, message(admin, lifetime, this.instructions({ unitPrice })));
  }
}

export class Deploy<F extends readonly FieldLike[]> {
  constructor(private readonly doppler: Doppler<F>) {}

  /**
   * Writes the program, deploys it immutable, and creates the feed account, in one transaction when it
   * fits. `signers` are the admin, who pays, and the program keypair, needed only here.
   */
  async send(signers: readonly TransactionSigner[], { rpc, unitPrice }: SendOptions): Promise<Signature> {
    const admin = expect(signers, this.doppler.admin);
    expect(signers, this.doppler.program);
    const [write, deploy] = await this.instructions(signers, await generateKeyPairSigner());
    const { value: lifetime } = await rpc.getLatestBlockhash().send();
    const fee = getSetComputeUnitPriceInstruction({ microLamports: unitPrice });
    const single = message(admin, lifetime, [fee, ...write, ...deploy]);
    if (isTransactionWithinSizeLimit(compileTransaction(single))) return send(rpc, single);
    await send(rpc, message(admin, lifetime, [fee, ...write]));
    return send(rpc, message(admin, lifetime, [fee, ...deploy]));
  }

  /** `[buffer create + write, program create + deploy + finalize + feed create]`, for your own transactions. */
  async instructions(signers: readonly TransactionSigner[], buffer: TransactionSigner): Promise<[Instruction[], Instruction[]]> {
    const d = this.doppler;
    const admin = expect(signers, d.admin);
    const program = expect(signers, d.program);
    const elf = d.feed.elf();
    const [programdata] = await getProgramDerivedAddress({
      programAddress: LOADER_V3_PROGRAM_ADDRESS,
      seeds: [getAddressEncoder().encode(d.program)],
    });
    const bufferLen = BUFFER_HEADER + elf.length;
    const feedLen = HEADER + d.feed.size;
    return [
      [
        getCreateAccountInstruction({
          payer: admin,
          newAccount: buffer,
          lamports: rentExempt(bufferLen),
          space: bufferLen,
          programAddress: LOADER_V3_PROGRAM_ADDRESS,
        }),
        getInitializeBufferInstruction({ sourceAccount: buffer.address, bufferAuthority: admin.address }),
        getWriteInstruction({ bufferAccount: buffer.address, bufferAuthority: admin, offset: 0, bytes: elf }),
      ],
      [
        getCreateAccountInstruction({
          payer: admin,
          newAccount: program,
          lamports: rentExempt(PROGRAM_LEN),
          space: PROGRAM_LEN,
          programAddress: LOADER_V3_PROGRAM_ADDRESS,
        }),
        getDeployWithMaxDataLenInstruction({
          payerAccount: admin,
          programDataAccount: programdata,
          programAccount: d.program,
          bufferAccount: buffer.address,
          authority: admin,
          maxDataLen: elf.length,
        }),
        immutable(getSetAuthorityInstruction({ bufferOrProgramDataAccount: programdata, currentAuthority: admin })),
        getCreateAccountWithSeedInstruction({
          payer: admin,
          newAccount: d.address,
          base: d.admin,
          seed: FEED_SEED,
          amount: rentExempt(feedLen),
          space: feedLen,
          programAddress: d.program,
        }),
      ],
    ];
  }
}
