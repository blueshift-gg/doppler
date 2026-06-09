import {
  deserializeOracle,
  oracleAccountSize,
} from "@blueshift-gg/doppler-core";
import type { Oracle, PayloadSerializer } from "@blueshift-gg/doppler-core";
import {
  Address,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  type Connection,
  type Keypair,
} from "@solana/web3.js";
import { TransactionBuilder } from "./transaction-builder";
import type { DopplerWeb3Config } from "./types";

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
    this.admin = config.admin ?? signer.publicKey;
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
    serializer: PayloadSerializer<T>,
  ): Promise<Oracle<T> | null> {
    const accountInfo = await this.connection.getAccountInfo(oraclePubkey);
    if (!accountInfo?.data) {
      return null;
    }

    return deserializeOracle(accountInfo.data, serializer);
  }

  /** Deserialize oracle account data from raw bytes. */
  deserializeOracle<T>(
    data: Uint8Array,
    serializer: PayloadSerializer<T>,
  ): Oracle<T> {
    return deserializeOracle(data, serializer);
  }

  /** Create a program-owned oracle account derived from a seed. */
  async createOracleAccount<T>(
    seed: string,
    serializer: PayloadSerializer<T>,
  ): Promise<Address> {
    const space = oracleAccountSize(serializer);
    const lamports = await this.connection.getMinimumBalanceForRentExemption(
      space,
    );

    const oraclePubkey = await Address.createWithSeed(
      this.signer.publicKey,
      seed,
      this.programId,
    );

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
    serializer: PayloadSerializer<T>,
    unitPrice?: bigint,
  ): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();

    let builder = this.createTransactionBuilder().addOracleUpdate(
      oraclePubkey,
      oracle,
      serializer,
    );

    if (unitPrice !== undefined) {
      builder = builder.withUnitPrice(unitPrice);
    }

    const transaction = await builder.build(blockhash, lastValidBlockHeight);
    return sendAndConfirmTransaction(this.connection, transaction, [
      this.signer,
    ]);
  }

  /** Update multiple oracle accounts in one transaction. */
  async updateMultipleOracles<T>(
    updates: Array<{
      oraclePubkey: Address;
      oracle: Oracle<T>;
      serializer: PayloadSerializer<T>;
    }>,
    unitPrice?: bigint,
  ): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();

    let builder = this.createTransactionBuilder();

    for (const update of updates) {
      builder = builder.addOracleUpdate(
        update.oraclePubkey,
        update.oracle,
        update.serializer,
      );
    }

    if (unitPrice !== undefined) {
      builder = builder.withUnitPrice(unitPrice);
    }

    const transaction = await builder.build(blockhash, lastValidBlockHeight);
    return sendAndConfirmTransaction(this.connection, transaction, [
      this.signer,
    ]);
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
