import { deserializeOracle, oracleAccountSize } from "@blueshift-gg/doppler-common";
import type { Oracle, FixedSizeCodec } from "@blueshift-gg/doppler-common";
import {
  Address,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  type Commitment,
  type Connection,
  type Keypair,
} from "@solana/web3.js";

import { TransactionBuilder } from "./transaction-builder";
import type { DopplerWeb3Config } from "./types";

export type SubscribeToOracleOptions = Readonly<{
  commitment?: Commitment;
}>;

export type OracleSubscription<T> = Readonly<{
  notifications: AsyncIterable<Oracle<T>>;
  unsubscribe: () => Promise<void>;
}>;

/** Client for creating, updating, and reading Doppler oracle accounts. */
export class Doppler {
  private readonly programId: Address;
  private readonly admin: Address;

  constructor(
    private readonly connection: Connection,
    private readonly signer: Keypair,
    config: DopplerWeb3Config,
  ) {
    this.programId = config.programId;
    this.admin = config.admin;
  }

  /** Create a transaction builder configured for this client. */
  createTransactionBuilder(): TransactionBuilder {
    return TransactionBuilder.fromContext({
      signer: this.signer,
      programId: this.programId,
      admin: this.admin,
    });
  }

  /** Fetch and deserialize an oracle account. */
  async fetchOracle<T>(
    oraclePubkey: Address,
    payloadCodec: FixedSizeCodec<T>,
  ): Promise<Oracle<T> | null> {
    const accountInfo = await this.connection.getAccountInfo(oraclePubkey);
    if (!accountInfo?.data) {
      return null;
    }

    return deserializeOracle(accountInfo.data, payloadCodec);
  }

  /** Deserialize oracle account data from raw bytes. */
  deserializeOracle<T>(data: Uint8Array, payloadCodec: FixedSizeCodec<T>): Oracle<T> {
    return deserializeOracle(data, payloadCodec);
  }

  /** Subscribe to live oracle account updates over WebSocket. */
  subscribeToOracle<T>(
    oraclePubkey: Address,
    payloadCodec: FixedSizeCodec<T>,
    options: SubscribeToOracleOptions = {},
  ): OracleSubscription<T> {
    const { commitment = "confirmed" } = options;
    let resolvePending: ((result: IteratorResult<Oracle<T>>) => void) | null = null;
    const queue: Oracle<T>[] = [];
    let closed = false;

    const subscriptionId = this.connection.onAccountChange(
      oraclePubkey,
      (accountInfo) => {
        const oracle = deserializeOracle<T>(accountInfo.data, payloadCodec);
        if (resolvePending) {
          const resolve = resolvePending;
          resolvePending = null;
          resolve({ value: oracle, done: false });
          return;
        }

        queue.push(oracle);
      },
      {
        commitment,
        encoding: "base58",
      },
    );

    const notifications: AsyncIterable<Oracle<T>> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<Oracle<T>>> {
            if (queue.length > 0) {
              return Promise.resolve({ value: queue.shift()!, done: false });
            }

            if (closed) {
              return Promise.resolve({ value: undefined, done: true });
            }

            return new Promise((resolve) => {
              resolvePending = resolve;
            });
          },
        };
      },
    };

    return {
      notifications,
      unsubscribe: async () => {
        closed = true;
        if (resolvePending) {
          resolvePending({ value: undefined, done: true });
          resolvePending = null;
        }

        await this.connection.removeAccountChangeListener(subscriptionId);
      },
    };
  }

  /** Create a program-owned oracle account derived from a seed. */
  async createOracleAccount<T>(seed: string, payloadCodec: FixedSizeCodec<T>): Promise<Address> {
    const space = oracleAccountSize(payloadCodec);
    const lamports = await this.connection.getMinimumBalanceForRentExemption(space);

    const oraclePubkey = await Address.createWithSeed(this.signer.publicKey, seed, this.programId);

    const createAccountInstruction = SystemProgram.createAccountWithSeed({
      fromPubkey: this.signer.publicKey,
      newAccountPubkey: oraclePubkey,
      basePubkey: this.signer.publicKey,
      seed,
      lamports,
      space,
      programId: this.programId,
    });

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    const transaction = new Transaction({
      feePayer: this.signer.publicKey,
      blockhash,
      lastValidBlockHeight,
    });

    transaction.add(createAccountInstruction);
    await transaction.sign(this.signer);

    await sendAndConfirmTransaction(this.connection, transaction, [this.signer]);

    return oraclePubkey;
  }

  /** Update a single oracle account. */
  async updateOracle<T>(
    oraclePubkey: Address,
    oracle: Oracle<T>,
    payloadCodec: FixedSizeCodec<T>,
    unitPrice?: bigint,
  ): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();

    let builder = this.createTransactionBuilder().addOracleUpdate(
      oraclePubkey,
      oracle,
      payloadCodec,
    );

    if (unitPrice !== undefined) {
      builder = builder.withUnitPrice(unitPrice);
    }

    const transaction = await builder.build(blockhash, lastValidBlockHeight);
    return sendAndConfirmTransaction(this.connection, transaction, [this.signer]);
  }

  /** Update multiple oracle accounts in one transaction. */
  async updateMultipleOracles<T>(
    updates: Array<{
      oraclePubkey: Address;
      oracle: Oracle<T>;
      payloadCodec: FixedSizeCodec<T>;
    }>,
    unitPrice?: bigint,
  ): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();

    let builder = this.createTransactionBuilder();

    for (const update of updates) {
      builder = builder.addOracleUpdate(update.oraclePubkey, update.oracle, update.payloadCodec);
    }

    if (unitPrice !== undefined) {
      builder = builder.withUnitPrice(unitPrice);
    }

    const transaction = await builder.build(blockhash, lastValidBlockHeight);
    return sendAndConfirmTransaction(this.connection, transaction, [this.signer]);
  }

  getSigner(): Keypair {
    return this.signer;
  }

  getConnection(): Connection {
    return this.connection;
  }

  getProgramId(): Address {
    return this.programId;
  }

  getAdmin(): Address {
    return this.admin;
  }
}
