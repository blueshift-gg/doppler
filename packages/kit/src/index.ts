// @solana/kit client for Doppler feeds: `load` a manifest, `deploy` once, then `update`, `read`, `subscribe`.

import { BUFFER_HEADER, BUFFER_SEED, FEED_SEED, Feed, HEADER, PROGRAM_LEN, rentExempt } from '../../core/index.js';
import type { Budget, Field, FieldLike, Manifest, Payload, Reading } from '../../core/index.js';
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createAddressWithSeed,
  createTransactionMessage,
  fetchEncodedAccount,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from '@solana/kit';
import type {
  AccountNotificationsApi,
  Address,
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
import { getCreateAccountWithSeedInstruction } from '@solana-program/system';

export type { Budget, Feed, Field, FieldLike, Manifest, Payload, Reading, Ty } from '../../core/index.js';

export type DopplerRpc = Rpc<
  GetAccountInfoApi & GetLatestBlockhashApi & SendTransactionApi & GetSignatureStatusesApi & GetBlockHeightApi
>;
/** `unitPrice` is the priority fee in micro-lamports per compute unit. */
export type SendOptions = { rpc: DopplerRpc; unitPrice: number | bigint };
/** The raw update instruction, which the admin signs, and its budget. */
export type UpdateInstruction = { instruction: Instruction; budget: Budget };
/**
 * The raw deploy instructions and their budget: create and fill the buffer, create the program, deploy it
 * immutable, create the feed. The admin pays and is the only signer.
 */
export type DeployInstructions = { instructions: Instruction[]; budget: Budget };

function expect(signers: readonly TransactionSigner[], key: Address): TransactionSigner {
  const signer = signers.find((s) => s.address === key);
  if (!signer) throw new Error(`${key} must sign`);
  return signer;
}

/** The loader takes any third account as the new authority; the generated client fills the omitted one with its own address. */
function immutable<T extends Instruction>(setAuthority: T): T {
  return { ...setAuthority, accounts: setAuthority.accounts?.slice(0, 2) };
}

/** The compute budget `send` sets, then the instructions. */
function budgeted(unitPrice: number | bigint, budget: Budget, instructions: readonly Instruction[]): Instruction[] {
  return [
    getSetComputeUnitPriceInstruction({ microLamports: unitPrice }),
    getSetLoadedAccountsDataSizeLimitInstruction({ accountDataSizeLimit: budget.requestedLoadedBytes }),
    getSetComputeUnitLimitInstruction({ units: budget.requestedComputeUnits }),
    ...instructions,
  ];
}

async function send(rpc: DopplerRpc, payer: TransactionSigner, instructions: readonly Instruction[]): Promise<Signature> {
  const { value: lifetime } = await rpc.getLatestBlockhash().send();
  const transactionMessage = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const transaction = await signTransactionMessageWithSigners(transactionMessage);
  const signature = getSignatureFromTransaction(transaction);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(transaction), { encoding: 'base64' }).send();
  for (;;) {
    const { value: [status] } = await rpc.getSignatureStatuses([signature]).send();
    if (status?.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return signature;
    if ((await rpc.getBlockHeight().send()) > lifetime.lastValidBlockHeight) throw new Error(`transaction ${signature} expired`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

/** One program, one admin, one payload layout, one feed account, one way to send. */
export class DopplerClient<F extends readonly FieldLike[] = readonly Field[]> {
  /** `createWithSeed(admin, seed, loader)`. */
  readonly program: Address;
  readonly admin: Address;
  /** The feed account. */
  readonly address: Address;

  private constructor(
    readonly feed: Feed<F>,
    public options: SendOptions,
  ) {
    this.program = address(feed.program);
    this.admin = address(feed.admin);
    this.address = address(feed.address);
  }

  static async load<const F extends readonly FieldLike[]>(manifest: Manifest<F>, options: SendOptions): Promise<DopplerClient<F>> {
    return new DopplerClient(await Feed.load(manifest), options);
  }

  get manifest(): Manifest<F> {
    return this.feed.manifest;
  }

  deploy(): Deploy<F> {
    return new Deploy(this);
  }

  /** `sequence` is any strictly increasing integer; unix milliseconds, `Date.now()`, is the convention. */
  update(sequence: number, value: Payload<F>): Update<F> {
    return new Update(this, sequence, value);
  }

  async read(): Promise<Reading<Payload<F>>> {
    const account = await fetchEncodedAccount(this.options.rpc, this.address);
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
    private readonly doppler: DopplerClient<F>,
    readonly sequence: number,
    readonly value: Payload<F>,
  ) {}

  /** The raw instruction and its budget, for your own transaction. */
  instruction(): UpdateInstruction {
    const d = this.doppler;
    return {
      instruction: {
        programAddress: d.program,
        accounts: [
          { address: d.admin, role: AccountRole.READONLY_SIGNER },
          { address: d.address, role: AccountRole.WRITABLE },
        ],
        data: d.feed.encode(this.sequence, this.value),
      },
      budget: d.feed.updateBudget(d.options.unitPrice),
    };
  }

  /** Exact budget, signed by the admin, who pays, confirmed. */
  async send(signers: readonly TransactionSigner[]): Promise<Signature> {
    const d = this.doppler;
    const admin = expect(signers, d.admin);
    const { instruction, budget } = this.instruction();
    return send(d.options.rpc, admin, budgeted(d.options.unitPrice, budget, [instruction]));
  }
}

export class Deploy<F extends readonly FieldLike[]> {
  constructor(private readonly doppler: DopplerClient<F>) {}

  /**
   * The raw instructions and their budget, for your own transaction. The program and the buffer are seeded
   * accounts of the admin, so nothing but the admin signs.
   */
  async instructions(signers: readonly TransactionSigner[]): Promise<DeployInstructions> {
    const d = this.doppler;
    const admin = expect(signers, d.admin);
    const elf = d.feed.elf();
    const loader = LOADER_V3_PROGRAM_ADDRESS;
    const buffer = await createAddressWithSeed({ baseAddress: admin.address, programAddress: loader, seed: BUFFER_SEED });
    const [programdata] = await getProgramDerivedAddress({ programAddress: loader, seeds: [getAddressEncoder().encode(d.program)] });
    const bufferLen = BUFFER_HEADER + elf.length;
    const feedLen = HEADER + d.feed.size;
    const create = (newAccount: Address, seed: string, space: number, programAddress: Address) =>
      getCreateAccountWithSeedInstruction({ payer: admin, newAccount, base: admin.address, seed, amount: rentExempt(space), space, programAddress });
    return {
      instructions: [
        create(buffer, BUFFER_SEED, bufferLen, loader),
        getInitializeBufferInstruction({ sourceAccount: buffer, bufferAuthority: admin.address }),
        getWriteInstruction({ bufferAccount: buffer, bufferAuthority: admin, offset: 0, bytes: elf }),
        create(d.program, d.manifest.seed, PROGRAM_LEN, loader),
        getDeployWithMaxDataLenInstruction({
          payerAccount: admin,
          programDataAccount: programdata,
          programAccount: d.program,
          bufferAccount: buffer,
          authority: admin,
          maxDataLen: elf.length,
        }),
        immutable(getSetAuthorityInstruction({ bufferOrProgramDataAccount: programdata, currentAuthority: admin })),
        create(d.address, FEED_SEED, feedLen, d.program),
      ],
      budget: d.feed.deployBudget(d.options.unitPrice),
    };
  }

  /** Exact budget, one transaction: writes the program, deploys it immutable, and creates the feed account. The admin signs and pays. */
  async send(signers: readonly TransactionSigner[]): Promise<Signature> {
    const d = this.doppler;
    const admin = expect(signers, d.admin);
    const { instructions, budget } = await this.instructions(signers);
    return send(d.options.rpc, admin, budgeted(d.options.unitPrice, budget, instructions));
  }
}
