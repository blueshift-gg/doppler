// @solana/web3.js 3 client for Doppler feeds: `load` a manifest, `deploy` once, then `update`, `read`, `subscribe`.
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
  ComputeBudgetProgram,
  Connection,
  LoaderV3Program,
  PACKET_DATA_SIZE,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import type { Blockhash, Signer, TransactionSignature } from '@solana/web3.js';

export type { Budget, Feed, Field, FieldLike, Manifest, Payload, Reading, Ty } from '../../core/index.js';

/** `unitPrice` is the priority fee in micro-lamports per compute unit. */
export type SendOptions = { rpc: Connection; unitPrice: number | bigint };
/** The raw update instruction and its budget. */
export type UpdateInstruction = { instruction: TransactionInstruction; budget: Budget };
/** The raw instructions of one deploy transaction and their budget. */
export type DeployInstructions = { instructions: TransactionInstruction[]; budget: Budget };

function expect(signers: readonly Signer[], key: PublicKey): Signer {
  const signer = signers.find((s) => s.address === key.toString());
  if (!signer) throw new Error(`${key} must sign`);
  return signer;
}

/** The loader takes any third account as the new authority; the generated client fills the omitted one with its own address. */
function immutable(setAuthority: TransactionInstruction): TransactionInstruction {
  setAuthority.keys.splice(2);
  return setAuthority;
}

/** The compute budget `send` sets, then the instructions. */
function budgeted(unitPrice: number | bigint, budget: Budget, instructions: TransactionInstruction[]): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: unitPrice }),
    ComputeBudgetProgram.setLoadedAccountsDataSizeLimit({ accountDataSizeLimit: budget.requestedLoadedBytes }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: budget.requestedComputeUnits }),
    ...instructions,
  ];
}

/** The serialized size of the transaction `send` builds around the instructions. */
function size(feePayer: PublicKey, unitPrice: number | bigint, instructions: TransactionInstruction[]): number {
  const tx = new Transaction({ feePayer, blockhash: feePayer.toString() as Blockhash, lastValidBlockHeight: 0 });
  tx.add(...budgeted(unitPrice, budget(0, 0, 1, unitPrice), instructions));
  return 1 + 64 + tx.compileMessage().serialize().length;
}

async function send(rpc: Connection, signers: readonly Signer[], feePayer: PublicKey, instructions: TransactionInstruction[]): Promise<TransactionSignature> {
  const lifetime = await rpc.getLatestBlockhash();
  const transaction = new Transaction({ feePayer, ...lifetime }).add(...instructions);
  const message = transaction.compileMessage();
  const required = message.accountKeys.slice(0, message.header.numRequiredSignatures);
  await transaction.sign(...required.map((key) => expect(signers, key)));
  const signature = await rpc.sendRawTransaction(await transaction.serialize());
  const { value } = await rpc.confirmTransaction({ signature, ...lifetime });
  if (value.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(value.err)}`);
  return signature;
}

/** One program, one admin, one payload layout, one feed account, one way to send. */
export class DopplerClient<F extends readonly FieldLike[] = readonly Field[]> {
  /** `createWithSeed(admin, seed, loader)`. */
  readonly program: PublicKey;
  readonly admin: PublicKey;
  /** The feed account. */
  readonly address: PublicKey;

  private constructor(
    readonly feed: Feed<F>,
    public options: SendOptions,
  ) {
    this.program = new PublicKey(feed.program);
    this.admin = new PublicKey(feed.admin);
    this.address = new PublicKey(feed.address);
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
    const account = await this.options.rpc.getAccountInfo(this.address);
    if (!account) throw new Error(`no feed account at ${this.address}`);
    return this.feed.decode(account.data, account.owner.toString());
  }

  /** Every confirmed write to the feed, until `signal` aborts or the loop breaks. */
  async *subscribe({ signal }: { signal?: AbortSignal } = {}): AsyncGenerator<Reading<Payload<F>>> {
    const rpc = this.options.rpc;
    const queue: { data: Uint8Array; owner: string }[] = [];
    let wake = () => {};
    const id = rpc.onAccountChange(this.address, ({ data, owner }) => {
      queue.push({ data, owner: owner.toString() });
      wake();
    });
    signal?.addEventListener('abort', () => wake(), { once: true });
    try {
      while (!signal?.aborted) {
        const next = queue.shift();
        if (next) yield this.feed.decode(next.data, next.owner);
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    } finally {
      await rpc.removeAccountChangeListener(id);
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
      instruction: new TransactionInstruction({
        programId: d.program,
        keys: [
          { pubkey: d.admin, isSigner: true, isWritable: false },
          { pubkey: d.address, isSigner: false, isWritable: true },
        ],
        data: d.feed.encode(this.sequence, this.value),
      }),
      budget: d.feed.updateBudget(d.options.unitPrice),
    };
  }

  /** Exact budget, signed by the admin, who pays, confirmed. */
  async send(signers: readonly Signer[]): Promise<TransactionSignature> {
    const d = this.doppler;
    expect(signers, d.admin);
    const { instruction, budget } = this.instruction();
    return send(d.options.rpc, signers, d.admin, budgeted(d.options.unitPrice, budget, [instruction]));
  }

  /**
   * The admin's detached signature over the update, off chain: `Pull.signed` is what to publish, and
   * `DopplerClient.pull` takes it back. `Keypair` signs messages; so does a wallet that does.
   */
  async sign(admin: Signer): Promise<Pull<F>> {
    const d = this.doppler;
    if (admin.address !== d.admin.toString()) throw new Error(`${d.admin} must sign`);
    if (!('signMessages' in admin)) throw new Error(`${d.admin} must sign messages`);
    const update = d.feed.encode(this.sequence, this.value);
    const [signatures] = await admin.signMessages([{ content: d.feed.pullMessage(update), signatures: {} }]);
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
      instruction: new TransactionInstruction({
        programId: d.program,
        keys: [{ pubkey: d.address, isSigner: false, isWritable: true }],
        data: this.signed,
      }),
      budget: d.feed.pullBudget(d.options.unitPrice),
    };
  }

  /** Exact budget, the first signer pays, confirmed. */
  async send(signers: readonly Signer[]): Promise<TransactionSignature> {
    const d = this.doppler;
    const payer = signers[0];
    if (!payer) throw new Error('a pull needs a signer to pay');
    const { instruction, budget } = this.instruction();
    return send(d.options.rpc, signers, new PublicKey(payer.address), budgeted(d.options.unitPrice, budget, [instruction]));
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
  async instructions(): Promise<DeployInstructions[]> {
    const d = this.doppler;
    const unitPrice = d.options.unitPrice;
    const elf = d.feed.elf();
    const loader = LoaderV3Program.programId;
    const buffer = await PublicKey.createWithSeed(d.admin, BUFFER_SEED, loader);
    const [programdata] = await PublicKey.findProgramAddress([d.program.toBytes()], loader);
    const bufferLen = BUFFER_HEADER + elf.length;
    const create = (newAccountPubkey: PublicKey, seed: string, space: number, programId: PublicKey): [TransactionInstruction, number] => [
      SystemProgram.createAccountWithSeed({ fromPubkey: d.admin, newAccountPubkey, basePubkey: d.admin, seed, lamports: rentExempt(space), space, programId }),
      BUILTIN_IX_CU,
    ];
    const write = (offset: number, bytes: Uint8Array): [TransactionInstruction, number] => [
      LoaderV3Program.write({ bufferAccount: buffer, bufferAuthority: d.admin, offset, bytes }),
      LOADER_IX_CU,
    ];
    const ixs = (costed: readonly [TransactionInstruction, number][]) => costed.map(([ix]) => ix);

    const transactions: [TransactionInstruction, number][][] = [];
    let current: [TransactionInstruction, number][] = [
      create(buffer, BUFFER_SEED, bufferLen, loader),
      [LoaderV3Program.initializeBuffer({ sourceAccount: buffer, bufferAuthority: d.admin }), LOADER_IX_CU],
    ];
    let offset = 0;
    for (;;) {
      const rest = elf.subarray(offset);
      const over = Math.max(0, size(d.admin, unitPrice, [...ixs(current), write(offset, rest)[0]]) - PACKET_DATA_SIZE);
      const chunk = rest.length - over;
      current.push(write(offset, rest.subarray(0, chunk)));
      offset += chunk;
      if (offset === elf.length) break;
      transactions.push(current);
      current = [];
    }
    const finish: [TransactionInstruction, number][] = [
      create(d.program, d.manifest.seed, PROGRAM_LEN, loader),
      [
        LoaderV3Program.deployWithMaxDataLen({
          payerAccount: d.admin,
          programDataAccount: programdata,
          programAccount: d.program,
          bufferAccount: buffer,
          authority: d.admin,
          maxDataLen: BigInt(elf.length),
        }),
        LOADER_IX_CU + BUILTIN_IX_CU,
      ],
      [immutable(LoaderV3Program.setAuthority({ bufferOrProgramDataAccount: programdata, currentAuthority: d.admin })), LOADER_IX_CU],
      create(d.address, FEED_SEED, HEADER + padded(d.feed.size), d.program),
    ];
    if (size(d.admin, unitPrice, ixs([...current, ...finish])) > PACKET_DATA_SIZE) {
      transactions.push(current);
      current = [];
    }
    transactions.push([...current, ...finish]);

    return transactions.map((costed, i) => {
      const instructions = ixs(costed);
      const keys = new Set(instructions.flatMap((ix) => [...ix.keys.map((k) => k.pubkey.toString()), ix.programId.toString()]));
      keys.delete(d.admin.toString());
      let loadedBytes = 0;
      for (const key of keys) loadedBytes += ACCOUNT_OVERHEAD + (key === buffer.toString() && i > 0 ? bufferLen : (BUILTIN_LEN[key] ?? 0));
      const computeUnits = costed.reduce((sum, [, cu]) => sum + cu, 0);
      return { instructions, budget: budget(computeUnits, loadedBytes, 1, unitPrice) };
    });
  }

  /**
   * Exact budgets, one transaction after another, each confirmed: writes the program, deploys it immutable,
   * and creates the feed account. The admin signs and pays.
   */
  async send(signers: readonly Signer[]): Promise<TransactionSignature[]> {
    const d = this.doppler;
    expect(signers, d.admin);
    const signatures: TransactionSignature[] = [];
    for (const { instructions, budget } of await this.instructions()) {
      signatures.push(await send(d.options.rpc, signers, d.admin, budgeted(d.options.unitPrice, budget, instructions)));
    }
    return signatures;
  }
}
