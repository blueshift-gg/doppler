import {
  deserializeOracle,
  oracleAccountSize,
  oracleUpdateComputeBudget,
  serializeOracle,
} from "@blueshift-gg/doppler-common";
import type { Oracle, FixedSizeCodec } from "@blueshift-gg/doppler-common";
import {
  Address,
  ComputeBudgetProgram,
  SystemProgram,
  TransactionInstruction,
  type Commitment,
  type Connection,
} from "@solana/web3.js";

import type { DopplerConfig } from "./types";

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
    config: DopplerConfig,
  ) {
    this.programId = config.programId;
    this.admin = config.admin;
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

  /** Build an instruction that initializes a oracle account derived from a seed. */
  async createOracleAccount<T>(
    seed: string,
    payloadCodec: FixedSizeCodec<T>,
    payer: Address,
  ): Promise<{ oraclePubkey: Address; instruction: TransactionInstruction }> {
    const space = oracleAccountSize(payloadCodec);
    const lamports = await this.connection.getMinimumBalanceForRentExemption(space);

    const oraclePubkey = await Address.createWithSeed(payer, seed, this.programId);

    const instruction = SystemProgram.createAccountWithSeed({
      fromPubkey: payer,
      newAccountPubkey: oraclePubkey,
      basePubkey: payer,
      seed,
      lamports,
      space,
      programId: this.programId,
    });

    return { oraclePubkey, instruction };
  }

  /** Build compute budget and oracle update instructions. */
  createUpdateInstructions<T>(
    updates: Array<{
      oraclePubkey: Address;
      oracle: Oracle<T>;
      payloadCodec: FixedSizeCodec<T>;
    }>,
    unitPrice?: bigint,
  ): TransactionInstruction[] {
    const payloadCodecs = updates.map((update) => update.payloadCodec) as FixedSizeCodec<unknown>[];
    const budget =
      unitPrice === undefined
        ? oracleUpdateComputeBudget(payloadCodecs)
        : oracleUpdateComputeBudget(payloadCodecs, { unitPrice });

    const instructions: TransactionInstruction[] = [];

    if (unitPrice !== undefined) {
      instructions.push(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: unitPrice,
        }),
      );
    }

    instructions.push(
      ComputeBudgetProgram.setLoadedAccountsDataSizeLimit({
        accountDataSizeLimit: budget.loadedAccountDataSize,
      }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: budget.computeUnits }),
    );

    for (const update of updates) {
      instructions.push(
        new TransactionInstruction({
          programId: this.programId,
          keys: [
            {
              pubkey: this.admin,
              isSigner: true,
              isWritable: false,
            },
            {
              pubkey: update.oraclePubkey,
              isSigner: false,
              isWritable: true,
            },
          ],
          data: serializeOracle(update.oracle, update.payloadCodec),
        }),
      );
    }

    return instructions;
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
