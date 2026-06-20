import {
  COMPUTE_BUDGET_DATA_LIMIT_SIZE,
  COMPUTE_BUDGET_IX_CU,
  COMPUTE_BUDGET_PROGRAM_SIZE,
  COMPUTE_BUDGET_UNIT_LIMIT_SIZE,
  COMPUTE_BUDGET_UNIT_PRICE_SIZE,
  ORACLE_PROGRAM_SIZE,
  oracleUpdateComputeUnits,
  oracleUpdateLoadedAccountsDataSize,
} from "@blueshift-gg/doppler-common";
import type { Oracle, FixedSizeCodec } from "@blueshift-gg/doppler-common";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
  getSetLoadedAccountsDataSizeLimitInstruction,
} from "@solana-program/compute-budget";
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Blockhash,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";

import { createOracleUpdateInstruction } from "./instructions";
import type { KitDopplerContext } from "./types";

type SignableTransactionMessage = Parameters<typeof signTransactionMessageWithSigners>[0];

/** Transaction builder for batched Doppler oracle updates. */
export class TransactionBuilder {
  private readonly oracleUpdateInstructions: Instruction[] = [];
  private unitPrice?: bigint;
  private computeUnits = COMPUTE_BUDGET_IX_CU * 2;
  private loadedAccountDataSize =
    ORACLE_PROGRAM_SIZE +
    COMPUTE_BUDGET_PROGRAM_SIZE +
    COMPUTE_BUDGET_UNIT_LIMIT_SIZE +
    COMPUTE_BUDGET_DATA_LIMIT_SIZE +
    2;

  constructor(
    private readonly signer: TransactionSigner,
    private readonly programId: Address,
    private readonly admin: Address,
  ) {}

  /** Create a builder from shared Doppler context. */
  static fromContext(context: KitDopplerContext): TransactionBuilder {
    return new TransactionBuilder(context.signer, context.programId, context.admin);
  }

  /** Append an oracle update instruction. */
  addOracleUpdate<T>(
    oraclePubkey: Address,
    oracle: Oracle<T>,
    payloadCodec: FixedSizeCodec<T>,
  ): this {
    const instruction = createOracleUpdateInstruction(
      this.programId,
      this.admin,
      oraclePubkey,
      oracle,
      payloadCodec,
    );

    this.computeUnits += oracleUpdateComputeUnits(payloadCodec);
    this.loadedAccountDataSize += oracleUpdateLoadedAccountsDataSize(payloadCodec) * 2;
    this.oracleUpdateInstructions.push(instruction);

    return this;
  }

  /** Set the compute unit price in micro-lamports. */
  withUnitPrice(microLamports: bigint): this {
    this.unitPrice = microLamports;
    return this;
  }

  /** Build an unsigned transaction message. */
  buildMessage(
    latestBlockhash: Readonly<{ blockhash: Blockhash; lastValidBlockHeight: bigint }>,
  ): SignableTransactionMessage {
    const instructions: Instruction[] = [];
    let loadedAccountDataSize = this.loadedAccountDataSize;
    let computeUnits = this.computeUnits;

    if (this.unitPrice !== undefined) {
      instructions.push(
        getSetComputeUnitPriceInstruction({
          microLamports: this.unitPrice,
        }),
      );
      loadedAccountDataSize += COMPUTE_BUDGET_UNIT_PRICE_SIZE;
      computeUnits += COMPUTE_BUDGET_IX_CU;
    }

    instructions.push(
      getSetLoadedAccountsDataSizeLimitInstruction({
        accountDataSizeLimit: loadedAccountDataSize,
      }),
    );
    instructions.push(
      getSetComputeUnitLimitInstruction({
        units: computeUnits,
      }),
    );
    instructions.push(...this.oracleUpdateInstructions);

    return pipe(
      createTransactionMessage({ version: 0 }),
      (message) => setTransactionMessageFeePayerSigner(this.signer, message),
      (message) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
      (message) => appendTransactionMessageInstructions(instructions, message),
    ) as SignableTransactionMessage;
  }
}
