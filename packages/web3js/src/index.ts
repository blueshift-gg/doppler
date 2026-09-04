// @solana/web3.js 3 client for Doppler feeds: `load` a manifest, `deploy` once, then `update`, `read`, `subscribe`.

import { BUFFER_HEADER, FEED_SEED, Feed, HEADER, PROGRAM_LEN, rentExempt } from '../../core/index.js';
import type { Field, FieldLike, Manifest, Payload, Reading } from '../../core/index.js';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LoaderV3Program,
  PACKET_DATA_SIZE,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import type { BlockhashWithExpiryBlockHeight, Signer, TransactionSignature } from '@solana/web3.js';

export type { Feed, Field, FieldLike, Manifest, Payload, Reading, Ty } from '../../core/index.js';

/** `unitPrice` is the priority fee in micro-lamports per compute unit. */
export type SendOptions = { rpc: Connection; unitPrice: number | bigint };

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

function transaction(feePayer: PublicKey, lifetime: BlockhashWithExpiryBlockHeight, instructions: TransactionInstruction[]) {
  return new Transaction({ feePayer, ...lifetime }).add(...instructions);
}

function size(transaction: Transaction): number {
  const message = transaction.compileMessage();
  return 1 + 64 * message.header.numRequiredSignatures + message.serialize().length;
}

async function send(
  rpc: Connection,
  signers: readonly Signer[],
  lifetime: BlockhashWithExpiryBlockHeight,
  transaction: Transaction,
): Promise<TransactionSignature> {
  const message = transaction.compileMessage();
  const required = message.accountKeys.slice(0, message.header.numRequiredSignatures);
  await transaction.sign(...required.map((key) => expect(signers, key)));
  const signature = await rpc.sendRawTransaction(await transaction.serialize());
  const { value } = await rpc.confirmTransaction({ signature, ...lifetime });
  if (value.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(value.err)}`);
  return signature;
}

/** One program, one admin, one payload layout, one feed account. */
export class Doppler<F extends readonly FieldLike[] = readonly Field[]> {
  readonly program: PublicKey;
  readonly admin: PublicKey;
  /** The feed account. */
  readonly address: PublicKey;

  private constructor(readonly feed: Feed<F>) {
    this.program = new PublicKey(feed.program);
    this.admin = new PublicKey(feed.admin);
    this.address = new PublicKey(feed.address);
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

  async read(rpc: Connection): Promise<Reading<Payload<F>>> {
    const account = await rpc.getAccountInfo(this.address);
    if (!account) throw new Error(`no feed account at ${this.address}`);
    return this.feed.decode(account.data, account.owner.toString());
  }

  /** Every confirmed write to the feed, until `signal` aborts or the loop breaks. */
  async *subscribe(rpc: Connection, { signal }: { signal?: AbortSignal } = {}): AsyncGenerator<Reading<Payload<F>>> {
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
    private readonly doppler: Doppler<F>,
    readonly sequence: number,
    readonly value: Payload<F>,
  ) {}

  /** The raw instruction, for your own transaction and budget. The admin signs. */
  instruction(): TransactionInstruction {
    const d = this.doppler;
    return new TransactionInstruction({
      programId: d.program,
      keys: [
        { pubkey: d.admin, isSigner: true, isWritable: false },
        { pubkey: d.address, isSigner: false, isWritable: true },
      ],
      data: d.feed.encode(this.sequence, this.value),
    });
  }

  /** The compute-budget instructions and the update, for a transaction that holds only this update. */
  instructions({ unitPrice }: { unitPrice: number | bigint }): TransactionInstruction[] {
    const { computeUnits, loadedBytes } = this.doppler.feed.budget();
    return [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: unitPrice }),
      ComputeBudgetProgram.setLoadedAccountsDataSizeLimit({ accountDataSizeLimit: loadedBytes }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
      this.instruction(),
    ];
  }

  /** Exact budget, signed by the admin, who pays, confirmed. */
  async send(signers: readonly Signer[], { rpc, unitPrice }: SendOptions): Promise<TransactionSignature> {
    const d = this.doppler;
    expect(signers, d.admin);
    const lifetime = await rpc.getLatestBlockhash();
    return send(rpc, signers, lifetime, transaction(d.admin, lifetime, this.instructions({ unitPrice })));
  }
}

export class Deploy<F extends readonly FieldLike[]> {
  constructor(private readonly doppler: Doppler<F>) {}

  /**
   * Writes the program, deploys it immutable, and creates the feed account, in one transaction when it
   * fits. `signers` are the admin, who pays, and the program keypair, needed only here.
   */
  async send(signers: readonly Signer[], { rpc, unitPrice }: SendOptions): Promise<TransactionSignature> {
    const d = this.doppler;
    expect(signers, d.admin);
    expect(signers, d.program);
    const buffer = await Keypair.generate();
    const [write, deploy] = await this.instructions(buffer.publicKey);
    const lifetime = await rpc.getLatestBlockhash();
    const fee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: unitPrice });
    const all = [...signers, buffer];
    const single = transaction(d.admin, lifetime, [fee, ...write, ...deploy]);
    if (size(single) <= PACKET_DATA_SIZE) return send(rpc, all, lifetime, single);
    await send(rpc, all, lifetime, transaction(d.admin, lifetime, [fee, ...write]));
    return send(rpc, all, lifetime, transaction(d.admin, lifetime, [fee, ...deploy]));
  }

  /** `[buffer create + write, program create + deploy + finalize + feed create]`, for your own transactions. */
  async instructions(buffer: PublicKey): Promise<[TransactionInstruction[], TransactionInstruction[]]> {
    const d = this.doppler;
    const elf = d.feed.elf();
    const [programdata] = await PublicKey.findProgramAddress([d.program.toBytes()], LoaderV3Program.programId);
    const bufferLen = BUFFER_HEADER + elf.length;
    const feedLen = HEADER + d.feed.size;
    return [
      [
        SystemProgram.createAccount({
          fromPubkey: d.admin,
          newAccountPubkey: buffer,
          lamports: rentExempt(bufferLen),
          space: bufferLen,
          programId: LoaderV3Program.programId,
        }),
        LoaderV3Program.initializeBuffer({ sourceAccount: buffer, bufferAuthority: d.admin }),
        LoaderV3Program.write({ bufferAccount: buffer, bufferAuthority: d.admin, offset: 0, bytes: elf }),
      ],
      [
        SystemProgram.createAccount({
          fromPubkey: d.admin,
          newAccountPubkey: d.program,
          lamports: rentExempt(PROGRAM_LEN),
          space: PROGRAM_LEN,
          programId: LoaderV3Program.programId,
        }),
        LoaderV3Program.deployWithMaxDataLen({
          payerAccount: d.admin,
          programDataAccount: programdata,
          programAccount: d.program,
          bufferAccount: buffer,
          authority: d.admin,
          maxDataLen: BigInt(elf.length),
        }),
        immutable(LoaderV3Program.setAuthority({ bufferOrProgramDataAccount: programdata, currentAuthority: d.admin })),
        SystemProgram.createAccountWithSeed({
          fromPubkey: d.admin,
          newAccountPubkey: d.address,
          basePubkey: d.admin,
          seed: FEED_SEED,
          lamports: rentExempt(feedLen),
          space: feedLen,
          programId: d.program,
        }),
      ],
    ];
  }
}
