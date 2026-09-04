// @solana/web3.js 3 client for Doppler feeds: `load` a manifest, `deploy` once, then `update`, `read`, `subscribe`.

import { BUFFER_HEADER, BUFFER_SEED, FEED_SEED, Feed, HEADER, PROGRAM_LEN, rentExempt } from '../../core/index.js';
import type { Budget, Field, FieldLike, Manifest, Payload, Reading } from '../../core/index.js';
import {
  ComputeBudgetProgram,
  Connection,
  LoaderV3Program,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import type { Signer, TransactionSignature } from '@solana/web3.js';

export type { Budget, Feed, Field, FieldLike, Manifest, Payload, Reading, Ty } from '../../core/index.js';

/** `unitPrice` is the priority fee in micro-lamports per compute unit. */
export type SendOptions = { rpc: Connection; unitPrice: number | bigint };
/** The raw update instruction, which the admin signs, and its budget. */
export type UpdateInstruction = { instruction: TransactionInstruction; budget: Budget };
/**
 * The raw deploy instructions and their budget: create and fill the buffer, create the program, deploy it
 * immutable, create the feed. The admin pays and is the only signer.
 */
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
}

export class Deploy<F extends readonly FieldLike[]> {
  constructor(private readonly doppler: DopplerClient<F>) {}

  /**
   * The raw instructions and their budget, for your own transaction. The program and the buffer are seeded
   * accounts of the admin, so nothing but the admin signs.
   */
  async instructions(): Promise<DeployInstructions> {
    const d = this.doppler;
    const elf = d.feed.elf();
    const loader = LoaderV3Program.programId;
    const buffer = await PublicKey.createWithSeed(d.admin, BUFFER_SEED, loader);
    const [programdata] = await PublicKey.findProgramAddress([d.program.toBytes()], loader);
    const bufferLen = BUFFER_HEADER + elf.length;
    const feedLen = HEADER + d.feed.size;
    const create = (newAccountPubkey: PublicKey, seed: string, space: number, programId: PublicKey) =>
      SystemProgram.createAccountWithSeed({ fromPubkey: d.admin, newAccountPubkey, basePubkey: d.admin, seed, lamports: rentExempt(space), space, programId });
    return {
      instructions: [
        create(buffer, BUFFER_SEED, bufferLen, loader),
        LoaderV3Program.initializeBuffer({ sourceAccount: buffer, bufferAuthority: d.admin }),
        LoaderV3Program.write({ bufferAccount: buffer, bufferAuthority: d.admin, offset: 0, bytes: elf }),
        create(d.program, d.manifest.seed, PROGRAM_LEN, loader),
        LoaderV3Program.deployWithMaxDataLen({
          payerAccount: d.admin,
          programDataAccount: programdata,
          programAccount: d.program,
          bufferAccount: buffer,
          authority: d.admin,
          maxDataLen: BigInt(elf.length),
        }),
        immutable(LoaderV3Program.setAuthority({ bufferOrProgramDataAccount: programdata, currentAuthority: d.admin })),
        create(d.address, FEED_SEED, feedLen, d.program),
      ],
      budget: d.feed.deployBudget(d.options.unitPrice),
    };
  }

  /** Exact budget, one transaction: writes the program, deploys it immutable, and creates the feed account. The admin signs and pays. */
  async send(signers: readonly Signer[]): Promise<TransactionSignature> {
    const d = this.doppler;
    expect(signers, d.admin);
    const { instructions, budget } = await this.instructions();
    return send(d.options.rpc, signers, d.admin, budgeted(d.options.unitPrice, budget, instructions));
  }
}
