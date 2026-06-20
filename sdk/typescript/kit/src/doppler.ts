import { deserializeOracle, oracleAccountSize } from "@blueshift-gg/doppler-common";
import type { Oracle, FixedSizeCodec } from "@blueshift-gg/doppler-common";
import { getCreateAccountWithSeedInstruction } from "@solana-program/system";
import {
  appendTransactionMessageInstructions,
  createAddressWithSeed,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Commitment,
  type TransactionSigner,
} from "@solana/kit";

import { decodeBase64AccountData } from "./decode-base64";
import { TransactionBuilder } from "./transaction-builder";
import type { DopplerKitConfig } from "./types";

type SolanaRpc = ReturnType<typeof createSolanaRpc>;
type SolanaRpcSubscriptions = ReturnType<typeof createSolanaRpcSubscriptions>;
type ConfirmableTransaction = Parameters<ReturnType<typeof sendAndConfirmTransactionFactory>>[0];

type AccountNotification = Readonly<{
  value: Readonly<{
    data: readonly [string, string];
  }> | null;
}>;

export type SubscribeToOracleOptions = Readonly<{
  commitment?: Commitment;
}>;

export type OracleSubscription<T> = Readonly<{
  notifications: AsyncIterable<Oracle<T>>;
  unsubscribe: () => void;
}>;

/** Client for creating, updating, and reading Doppler oracle accounts. */
export class Doppler {
  private readonly programId: Address;
  private readonly admin: Address;
  private readonly sendAndConfirmTransaction: ReturnType<typeof sendAndConfirmTransactionFactory>;

  constructor(
    private readonly rpc: SolanaRpc,
    private readonly rpcSubscriptions: SolanaRpcSubscriptions,
    private readonly signer: TransactionSigner,
    config: DopplerKitConfig,
  ) {
    this.programId = config.programId;
    this.admin = config.admin;
    this.sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
      rpc,
      rpcSubscriptions,
    } as Parameters<typeof sendAndConfirmTransactionFactory>[0]);
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
    const { value: accountInfo } = await this.rpc
      .getAccountInfo(oraclePubkey, { encoding: "base64" })
      .send();

    if (!accountInfo) {
      return null;
    }

    const [encodedData] = accountInfo.data;
    return deserializeOracle(decodeBase64AccountData(encodedData), payloadCodec);
  }

  /** Deserialize oracle account data from raw bytes. */
  deserializeOracle<T>(data: Uint8Array, payloadCodec: FixedSizeCodec<T>): Oracle<T> {
    return deserializeOracle(data, payloadCodec);
  }

  /** Subscribe to live oracle account updates over WebSocket. */
  async subscribeToOracle<T>(
    oraclePubkey: Address,
    payloadCodec: FixedSizeCodec<T>,
    options: SubscribeToOracleOptions = {},
  ): Promise<OracleSubscription<T>> {
    const abortController = new AbortController();
    const { commitment = "confirmed" } = options;

    const accountNotifications = await this.rpcSubscriptions
      .accountNotifications(oraclePubkey, {
        encoding: "base64",
        commitment,
      })
      .subscribe({ abortSignal: abortController.signal });

    return {
      notifications: mapOracleNotifications(accountNotifications, payloadCodec),
      unsubscribe: () => {
        abortController.abort();
      },
    };
  }

  /** Create a program-owned oracle account derived from a seed. */
  async createOracleAccount<T>(seed: string, payloadCodec: FixedSizeCodec<T>): Promise<Address> {
    const space = oracleAccountSize(payloadCodec);
    const lamports = await this.rpc.getMinimumBalanceForRentExemption(BigInt(space)).send();

    const oraclePubkey = await createAddressWithSeed({
      baseAddress: this.signer.address,
      seed,
      programAddress: this.programId,
    });

    const createAccountInstruction = getCreateAccountWithSeedInstruction({
      payer: this.signer,
      newAccount: oraclePubkey,
      baseAccount: this.signer,
      base: this.signer.address,
      seed,
      amount: lamports,
      space,
      programAddress: this.programId,
    });

    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (message) => setTransactionMessageFeePayerSigner(this.signer, message),
      (message) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
      (message) => appendTransactionMessageInstructions([createAccountInstruction], message),
    );

    const transaction = await signTransactionMessageWithSigners(
      transactionMessage as Parameters<typeof signTransactionMessageWithSigners>[0],
    );
    await this.sendAndConfirmTransaction(transaction as ConfirmableTransaction, {
      commitment: "confirmed",
    });

    return oraclePubkey;
  }

  /** Update a single oracle account. */
  async updateOracle<T>(
    oraclePubkey: Address,
    oracle: Oracle<T>,
    payloadCodec: FixedSizeCodec<T>,
    unitPrice?: bigint,
  ): Promise<string> {
    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

    let builder = this.createTransactionBuilder().addOracleUpdate(
      oraclePubkey,
      oracle,
      payloadCodec,
    );

    if (unitPrice !== undefined) {
      builder = builder.withUnitPrice(unitPrice);
    }

    const transactionMessage = builder.buildMessage(latestBlockhash);
    const transaction = await signTransactionMessageWithSigners(transactionMessage);
    const signature = getSignatureFromTransaction(transaction);
    await this.sendAndConfirmTransaction(transaction as ConfirmableTransaction, {
      commitment: "confirmed",
    });

    return signature;
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
    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

    let builder = this.createTransactionBuilder();

    for (const update of updates) {
      builder = builder.addOracleUpdate(update.oraclePubkey, update.oracle, update.payloadCodec);
    }

    if (unitPrice !== undefined) {
      builder = builder.withUnitPrice(unitPrice);
    }

    const transactionMessage = builder.buildMessage(latestBlockhash);
    const transaction = await signTransactionMessageWithSigners(transactionMessage);
    const signature = getSignatureFromTransaction(transaction);
    await this.sendAndConfirmTransaction(transaction as ConfirmableTransaction, {
      commitment: "confirmed",
    });

    return signature;
  }

  getSigner(): TransactionSigner {
    return this.signer;
  }

  getRpc(): SolanaRpc {
    return this.rpc;
  }

  getProgramId(): Address {
    return this.programId;
  }

  getAdmin(): Address {
    return this.admin;
  }
}

async function* mapOracleNotifications<T>(
  notifications: AsyncIterable<AccountNotification>,
  payloadCodec: FixedSizeCodec<T>,
): AsyncGenerator<Oracle<T>> {
  for await (const notification of notifications) {
    const accountInfo = notification.value;
    if (!accountInfo) {
      continue;
    }

    const [encodedData] = accountInfo.data;
    yield deserializeOracle(decodeBase64AccountData(encodedData), payloadCodec);
  }
}
