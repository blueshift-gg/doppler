import {
  COMPUTE_BUDGET_DATA_LIMIT_SIZE,
  COMPUTE_BUDGET_IX_CU,
  COMPUTE_BUDGET_PROGRAM_SIZE,
  COMPUTE_BUDGET_UNIT_LIMIT_SIZE,
  COMPUTE_BUDGET_UNIT_PRICE_SIZE,
  ORACLE_PROGRAM_SIZE,
  oracleUpdateComputeUnits,
  oracleUpdateLoadedAccountsDataSize,
  serializeOracle,
} from "@blueshift-gg/doppler-core";
import type { Oracle, PayloadSerializer } from "@blueshift-gg/doppler-core";
import {
  Address,
  ComputeBudgetProgram,
  Transaction,
  TransactionInstruction,
  type Blockhash,
  type Keypair,
} from "@solana/web3.js";

import { setLoadedAccountsDataSizeLimit } from "./compute-budget";
import type { Web3DopplerContext } from "./types";

/** Transaction builder for batched Doppler oracle updates. */
export class TransactionBuilder {
  private readonly oracleUpdateInstructions: TransactionInstruction[] = [];
  private unitPrice?: bigint;
  private computeUnits = COMPUTE_BUDGET_IX_CU * 2;
  private loadedAccountDataSize =
    ORACLE_PROGRAM_SIZE +
    COMPUTE_BUDGET_PROGRAM_SIZE +
    COMPUTE_BUDGET_UNIT_LIMIT_SIZE +
    COMPUTE_BUDGET_DATA_LIMIT_SIZE +
    2;

  constructor(
    private readonly signer: Keypair,
    private readonly programId: Address,
    private readonly admin: Address,
  ) {}

  /** Create a builder from shared Doppler context. */
  static fromContext(context: Web3DopplerContext): TransactionBuilder {
    return new TransactionBuilder(context.signer, context.programId, context.admin);
  }

  /** Append an oracle update instruction. */
  addOracleUpdate<T>(
    oraclePubkey: Address,
    oracle: Oracle<T>,
    serializer: PayloadSerializer<T>,
  ): this {
    const instruction = this.createUpdateInstruction(oraclePubkey, oracle, serializer);

    this.computeUnits += oracleUpdateComputeUnits(serializer);
    this.loadedAccountDataSize += oracleUpdateLoadedAccountsDataSize(serializer) * 2;
    this.oracleUpdateInstructions.push(instruction);

    return this;
  }

  /** Set the compute unit price in micro-lamports. */
  withUnitPrice(microLamports: bigint): this {
    this.unitPrice = microLamports;
    return this;
  }

  /** Build and sign the transaction. */
  async build(blockhash: Blockhash, lastValidBlockHeight: number | bigint): Promise<Transaction> {
    const instructions: TransactionInstruction[] = [];
    let loadedAccountDataSize = this.loadedAccountDataSize;
    let computeUnits = this.computeUnits;

    if (this.unitPrice !== undefined) {
      instructions.push(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.unitPrice,
        }),
      );
      loadedAccountDataSize += COMPUTE_BUDGET_UNIT_PRICE_SIZE;
      computeUnits += COMPUTE_BUDGET_IX_CU;
    }

    instructions.push(setLoadedAccountsDataSizeLimit(loadedAccountDataSize));
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
    instructions.push(...this.oracleUpdateInstructions);

    const transaction = new Transaction({
      feePayer: this.signer.publicKey,
      blockhash,
      lastValidBlockHeight,
    });

    transaction.add(...instructions);
    await transaction.sign(this.signer);

    return transaction;
  }

  private createUpdateInstruction<T>(
    oraclePubkey: Address,
    oracle: Oracle<T>,
    serializer: PayloadSerializer<T>,
  ): TransactionInstruction {
    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        {
          pubkey: this.admin,
          isSigner: true,
          isWritable: false,
        },
        {
          pubkey: oraclePubkey,
          isSigner: false,
          isWritable: true,
        },
      ],
      data: serializeOracle(oracle, serializer),
    });
  }
}
