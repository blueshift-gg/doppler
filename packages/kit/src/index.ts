// @solana/kit client for Doppler feeds: `load` a manifest, `deploy` once, then `update`, `read`, `subscribe`.
// With a pull manifest the admin signs off chain, `update(..).sign(admin)`, and anyone lands the bytes,
// `pull(signed).send([relayer])`.

import {
  ACCOUNT_OVERHEAD,
  BUFFER_HEADER,
  BUFFER_SEED,
  BUILTIN_IX_CU,
  BUILTIN_LEN,
  FEED_SEED,
  Feed,
  HEADER,
  LOADER_IX_CU,
  PROGRAM_LEN,
  budget,
  padded,
  rentExempt,
} from '../../core/index.js';
import type { Budget, Field, FieldLike, Manifest, Payload, Reading } from '../../core/index.js';
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createAddressWithSeed,
  createSignableMessage,
  createTransactionMessage,
  fetchEncodedAccount,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  getTransactionEncoder,
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
  MessagePartialSigner,
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
import { SYSTEM_PROGRAM_ADDRESS, getCreateAccountWithSeedInstruction } from '@solana-program/system';

export type { Budget, Feed, Field, FieldLike, Manifest, Payload, Reading, Ty } from '../../core/index.js';

export type DopplerRpc = Rpc<
  GetAccountInfoApi & GetLatestBlockhashApi & SendTransactionApi & GetSignatureStatusesApi & GetBlockHeightApi
>;
/** `unitPrice` is the priority fee in micro-lamports per compute unit. */
export type SendOptions = { rpc: DopplerRpc; unitPrice: number | bigint };
/** The raw update instruction and its budget. */
export type UpdateInstruction = { instruction: Instruction; budget: Budget };
/** The raw instructions of one deploy transaction and their budget. */
export type DeployInstructions = { instructions: Instruction[]; budget: Budget };

/** `solana_packet::PACKET_DATA_SIZE`. */
const PACKET_DATA_SIZE = 1232;

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

function message(payer: TransactionSigner, lifetime: { blockhash: Blockhash; lastValidBlockHeight: bigint }, instructions: readonly Instruction[]) {
  return pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
}

/** The serialized size of the transaction `send` builds around the instructions. */
function size(payer: TransactionSigner, unitPrice: number | bigint, instructions: readonly Instruction[]): number {
  const lifetime = { blockhash: payer.address as string as Blockhash, lastValidBlockHeight: 0n };
  const compiled = compileTransaction(message(payer, lifetime, budgeted(unitPrice, budget(0, 0, 1, unitPrice), instructions)));
  return getTransactionEncoder().encode(compiled).length;
}

async function send(rpc: DopplerRpc, payer: TransactionSigner, instructions: readonly Instruction[]): Promise<Signature> {
  const { value: lifetime } = await rpc.getLatestBlockhash().send();
  const transaction = await signTransactionMessageWithSigners(message(payer, lifetime, instructions));
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

  /** The bytes of `Update.sign`, from wherever the admin published them. */
  pull(signed: Uint8Array): Pull<F> {
    return new Pull(this, this.feed.checkSigned(signed));
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

  /**
   * The admin's detached signature over the update, off chain: `Pull.signed` is what to publish, and
   * `DopplerClient.pull` takes it back.
   */
  async sign(admin: MessagePartialSigner): Promise<Pull<F>> {
    const d = this.doppler;
    if (admin.address !== d.admin) throw new Error(`${d.admin} must sign`);
    const update = d.feed.encode(this.sequence, this.value);
    const [signatures] = await admin.signMessages([createSignableMessage(d.feed.pullMessage(update))]);
    return new Pull(d, new Uint8Array([...signatures![admin.address]!, ...update]));
  }
}

/** An update the admin signed: the signature, then the sequence and the payload. Anyone sends it. */
export class Pull<F extends readonly FieldLike[]> {
  constructor(
    private readonly doppler: DopplerClient<F>,
    readonly signed: Uint8Array,
  ) {}

  /** The raw instruction and its budget, for your own transaction. One account, the feed. */
  instruction(): UpdateInstruction {
    const d = this.doppler;
    return {
      instruction: { programAddress: d.program, accounts: [{ address: d.address, role: AccountRole.WRITABLE }], data: this.signed },
      budget: d.feed.pullBudget(d.options.unitPrice),
    };
  }

  /** Exact budget, the first signer pays, confirmed. */
  async send(signers: readonly TransactionSigner[]): Promise<Signature> {
    const d = this.doppler;
    const payer = signers[0];
    if (!payer) throw new Error('a pull needs a signer to pay');
    const { instruction, budget } = this.instruction();
    return send(d.options.rpc, payer, budgeted(d.options.unitPrice, budget, [instruction]));
  }
}

export class Deploy<F extends readonly FieldLike[]> {
  constructor(private readonly doppler: DopplerClient<F>) {}

  /**
   * The raw instructions, one element per transaction, each with its budget: create and fill the buffer,
   * create the program, deploy it immutable, create the feed. The program and the buffer are seeded accounts
   * of the admin, so nothing but the admin signs. Writes take what a packet holds: a push program is one
   * transaction, a pull program several.
   */
  async instructions(signers: readonly TransactionSigner[]): Promise<DeployInstructions[]> {
    const d = this.doppler;
    const admin = expect(signers, d.admin);
    const unitPrice = d.options.unitPrice;
    const elf = d.feed.elf();
    const loader = LOADER_V3_PROGRAM_ADDRESS;
    const buffer = await createAddressWithSeed({ baseAddress: admin.address, programAddress: loader, seed: BUFFER_SEED });
    const [programdata] = await getProgramDerivedAddress({ programAddress: loader, seeds: [getAddressEncoder().encode(d.program)] });
    const bufferLen = BUFFER_HEADER + elf.length;
    const create = (newAccount: Address, seed: string, space: number, programAddress: Address): [Instruction, number] => [
      getCreateAccountWithSeedInstruction({ payer: admin, newAccount, base: admin.address, seed, amount: rentExempt(space), space, programAddress }),
      BUILTIN_IX_CU,
    ];
    const write = (offset: number, bytes: Uint8Array): [Instruction, number] => [
      getWriteInstruction({ bufferAccount: buffer, bufferAuthority: admin, offset, bytes }),
      LOADER_IX_CU,
    ];
    const ixs = (costed: readonly [Instruction, number][]) => costed.map(([ix]) => ix);

    const transactions: [Instruction, number][][] = [];
    let current: [Instruction, number][] = [
      create(buffer, BUFFER_SEED, bufferLen, loader),
      [getInitializeBufferInstruction({ sourceAccount: buffer, bufferAuthority: admin.address }), LOADER_IX_CU],
    ];
    let offset = 0;
    for (;;) {
      const rest = elf.subarray(offset);
      const over = Math.max(0, size(admin, unitPrice, [...ixs(current), write(offset, rest)[0]]) - PACKET_DATA_SIZE);
      const chunk = rest.length - over;
      current.push(write(offset, rest.subarray(0, chunk)));
      offset += chunk;
      if (offset === elf.length) break;
      transactions.push(current);
      current = [];
    }
    const finish: [Instruction, number][] = [
      create(d.program, d.manifest.seed, PROGRAM_LEN, loader),
      [
        getDeployWithMaxDataLenInstruction({
          payerAccount: admin,
          programDataAccount: programdata,
          programAccount: d.program,
          bufferAccount: buffer,
          authority: admin,
          maxDataLen: elf.length,
        }),
        LOADER_IX_CU + BUILTIN_IX_CU,
      ],
      [immutable(getSetAuthorityInstruction({ bufferOrProgramDataAccount: programdata, currentAuthority: admin })), LOADER_IX_CU],
      create(d.address, FEED_SEED, HEADER + padded(d.feed.size), d.program),
    ];
    if (size(admin, unitPrice, ixs([...current, ...finish])) > PACKET_DATA_SIZE) {
      transactions.push(current);
      current = [];
    }
    transactions.push([...current, ...finish]);

    return transactions.map((costed, i) => {
      const instructions = ixs(costed);
      const keys = new Set(instructions.flatMap((ix) => [...(ix.accounts ?? []).map((a) => a.address), ix.programAddress]));
      keys.delete(admin.address);
      let loadedBytes = 0;
      for (const key of keys) loadedBytes += ACCOUNT_OVERHEAD + (key === buffer && i > 0 ? bufferLen : (BUILTIN_LEN[key] ?? 0));
      const computeUnits = costed.reduce((sum, [, cu]) => sum + cu, 0);
      return { instructions, budget: budget(computeUnits, loadedBytes, 1, unitPrice) };
    });
  }

  /**
   * Exact budgets, one transaction after another, each confirmed: writes the program, deploys it immutable,
   * and creates the feed account. The admin signs and pays.
   */
  async send(signers: readonly TransactionSigner[]): Promise<Signature[]> {
    const d = this.doppler;
    const admin = expect(signers, d.admin);
    const signatures: Signature[] = [];
    for (const { instructions, budget } of await this.instructions(signers)) {
      signatures.push(await send(d.options.rpc, admin, budgeted(d.options.unitPrice, budget, instructions)));
    }
    return signatures;
  }
}
