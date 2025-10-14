import type { Address } from "@solana/addresses";
import type { ReadonlyUint8Array } from "@solana/codecs-core";
import type { Instruction } from "@solana/instructions";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
  getSetLoadedAccountsDataSizeLimitInstruction,
} from "@solana-program/compute-budget";
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type BaseTransactionMessage,
  type TransactionMessageWithBlockhashLifetime,
  type TransactionMessageWithFeePayer,
} from "@solana/transaction-messages";
import {
  signTransactionMessageWithSigners,
  type KeyPairSigner,
  type TransactionMessageWithSigners,
} from "@solana/signers";
import type { Blockhash } from "@solana/rpc-types";
import type { SendableTransaction, Transaction } from "@solana/transactions";
import type { TransactionWithLifetime } from "@solana/transactions";

import {
  COMPUTE_BUDGET_DATA_LIMIT_SIZE,
  COMPUTE_BUDGET_IX_CU,
  COMPUTE_BUDGET_PROGRAM_SIZE,
  COMPUTE_BUDGET_UNIT_LIMIT_SIZE,
  COMPUTE_BUDGET_UNIT_PRICE_SIZE,
  ORACLE_PROGRAM_SIZE,
} from "./constants.ts";
import {
  createOracleUpdateInstruction,
  type OracleUpdateInstruction,
} from "./instructions.ts";
import type { OracleData } from "./oracle.ts";

/** Options required to finalise a blockhash-based transaction. */
export interface BuildTransactionOptions {
  /** Recent blockhash used to constrain the transaction lifetime. */
  readonly blockhash: Blockhash;
  /** Highest block height where the blockhash remains valid. */
  readonly lastValidBlockHeight: bigint;
}

/**
 * Fluent builder for composing Doppler oracle updates and signing them with an admin keypair.
 * Mirrors the ergonomics of the Rust SDK while remaining payload-agnostic.
 */
export class DopplerTransactionBuilder {
  private readonly admin: KeyPairSigner;
  private readonly updates: OracleUpdateInstruction[] = [];
  private totalComputeUnits = COMPUTE_BUDGET_IX_CU * 2;
  private totalLoadedAccountDataSize =
    ORACLE_PROGRAM_SIZE +
    COMPUTE_BUDGET_PROGRAM_SIZE +
    COMPUTE_BUDGET_UNIT_LIMIT_SIZE +
    COMPUTE_BUDGET_DATA_LIMIT_SIZE +
    2;
  private unitPrice: number | bigint | undefined;

  /** Creates a new builder that signs transactions with the provided admin signer. */
  constructor(admin: KeyPairSigner) {
    this.admin = admin;
  }

  /**
   * Queues a new oracle update to be executed in the transaction.
   *
    * @param input.oracleAddress - Oracle PDA that should be mutated.
    * @param input.payload - Typed payload to serialise via `encodePayload`.
    * @param input.sequence - Monotonic sequence number for Doppler.
    * @param input.encodePayload - Encoder returning raw bytes for the payload.
   * @returns The builder, allowing fluent chaining.
   */
  addOracleUpdate<TPayload>(input: {
    readonly oracleAddress: Address<string>;
    readonly payload: TPayload;
    readonly sequence: OracleData<TPayload>["sequence"];
    readonly encodePayload: (payload: TPayload) => ReadonlyUint8Array;
  }): this {
    const { instruction, computeUnits, oracleDataSize } =
      createOracleUpdateInstruction({
        admin: this.admin,
        oracleAddress: input.oracleAddress,
        payload: input.payload,
        sequence: input.sequence,
        encodePayload: input.encodePayload,
      });

    this.totalComputeUnits += computeUnits;
    this.totalLoadedAccountDataSize += oracleDataSize * 2;
    this.updates.push(instruction);
    return this;
  }

  /**
   * Sets the priority fee in micro-lamports per compute unit for the whole transaction.
   *
   * @param microLamports - Priority fee to request during execution.
   * @returns The builder so further updates can be chained.
   */
  withUnitPrice(microLamports: number | bigint): this {
    this.unitPrice = microLamports;
    return this;
  }

  /**
   * Produces a transaction message containing compute-budget instructions and queued updates.
   *
   * @param options - Blockhash lifetime configuration for the transaction message.
   * @returns A versioned message ready for signing or further mutation.
   */
  buildTransactionMessage(
    options: BuildTransactionOptions
  ): BaseTransactionMessage &
    TransactionMessageWithFeePayer &
    TransactionMessageWithSigners &
    TransactionMessageWithBlockhashLifetime {
    const includeUnitPrice = this.unitPrice !== undefined;
    const computeUnits = includeUnitPrice
      ? this.totalComputeUnits + COMPUTE_BUDGET_IX_CU
      : this.totalComputeUnits;
    const loadedAccountDataSize = includeUnitPrice
      ? this.totalLoadedAccountDataSize + COMPUTE_BUDGET_UNIT_PRICE_SIZE
      : this.totalLoadedAccountDataSize;

    const computeBudgetInstructions: Instruction[] = [];

    if (includeUnitPrice) {
      computeBudgetInstructions.push(
        getSetComputeUnitPriceInstruction({ microLamports: this.unitPrice! })
      );
    }

    computeBudgetInstructions.push(
      getSetLoadedAccountsDataSizeLimitInstruction({
        accountDataSizeLimit: loadedAccountDataSize,
      })
    );

    computeBudgetInstructions.push(
      getSetComputeUnitLimitInstruction({ units: computeUnits })
    );

    const instructions: Instruction[] = [
      ...computeBudgetInstructions,
      ...this.updates,
    ];

    const base = createTransactionMessage({ version: 0 });
    const withFeePayer = setTransactionMessageFeePayer(
      this.admin.address,
      base
    );
    const withLifetime = setTransactionMessageLifetimeUsingBlockhash(
      {
        blockhash: options.blockhash,
        lastValidBlockHeight: options.lastValidBlockHeight,
      },
      withFeePayer
    );

    return appendTransactionMessageInstructions(instructions, withLifetime) as BaseTransactionMessage &
      TransactionMessageWithFeePayer &
      TransactionMessageWithSigners &
      TransactionMessageWithBlockhashLifetime;
  }

  /**
   * Signs the transaction message using the admin signer and returns a sendable transaction.
   *
   * @param options - Blockhash lifetime configuration.
   * @returns A fully signed transaction compatible with `sendAndConfirmTransaction`.
   */
  async build(options: BuildTransactionOptions): Promise<
    SendableTransaction &
      Transaction &
      TransactionWithLifetime &
      Readonly<{ lifetimeConstraint: { lastValidBlockHeight: bigint } }>
  > {
    const message = this.buildTransactionMessage(options);
    return (await signTransactionMessageWithSigners(message)) as SendableTransaction &
      Transaction &
      TransactionWithLifetime &
      Readonly<{ lifetimeConstraint: { lastValidBlockHeight: bigint } }>;
  }
}
