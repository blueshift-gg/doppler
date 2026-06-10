import {
  ComputeBudgetProgram,
  TransactionInstruction,
} from "@solana/web3.js";

/** Compute Budget instruction discriminator for `SetLoadedAccountsDataSizeLimit`. */
const SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_DISCRIMINATOR = 4;

/**
 * Build a compute-budget instruction that sets the loaded accounts data size
 * limit. web3.js 3.x does not expose this helper yet, so we encode it here.
 */
export function setLoadedAccountsDataSizeLimit(
  bytes: number,
): TransactionInstruction {
  const data = new Uint8Array(5);
  data[0] = SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_DISCRIMINATOR;
  new DataView(data.buffer).setUint32(1, bytes, true);
  return new TransactionInstruction({
    keys: [],
    programId: ComputeBudgetProgram.programId,
    data,
  });
}
