import type { Address } from "@solana/addresses";

/**
 * Program address for the Doppler oracle deployed alongside the test validator script.
 */
export const DOPPLER_PROGRAM_ADDRESS =
  "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm" as Address<
    "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm"
  >;

/** Compute-budget units consumed by Doppler's sequence check. */
export const SEQUENCE_CHECK_CU = 5;
/** Compute-budget units consumed when verifying the admin signer. */
export const ADMIN_VERIFICATION_CU = 6;
/** Compute-budget units consumed when writing the payload. */
export const PAYLOAD_WRITE_CU = 6;

/** Base compute-budget cost for each compute-budget instruction. */
export const COMPUTE_BUDGET_IX_CU = 150;
/** Serialized byte size of the compute-budget program account. */
export const COMPUTE_BUDGET_PROGRAM_SIZE = 22;
/** Serialized byte size contribution of `setComputeUnitLimit`. */
export const COMPUTE_BUDGET_UNIT_LIMIT_SIZE = 5;
/** Serialized byte size contribution of `setLoadedAccountsDataSizeLimit`. */
export const COMPUTE_BUDGET_DATA_LIMIT_SIZE = 5;
/** Serialized byte size contribution of `setComputeUnitPrice`. */
export const COMPUTE_BUDGET_UNIT_PRICE_SIZE = 9;
/** Serialized byte size of the Doppler program account. */
export const ORACLE_PROGRAM_SIZE = 36;

/** Default SOL/USDC oracle account shipped with the validator script. */
export const SOL_USDC_ORACLE_ADDRESS =
  "QUVF91dzXWYvE5FmFEc41JZxRDmNgx8S8P6sNDWYZiW" as Address<
    "QUVF91dzXWYvE5FmFEc41JZxRDmNgx8S8P6sNDWYZiW"
  >;

/** Default SOL/USDT oracle account shipped with the validator script. */
export const SOL_USDT_ORACLE_ADDRESS =
  "9bA7GPqPpZ5aLbwb8E6cKvUPM8pcHXXTqLpf5zLAqHP5" as Address<
    "9bA7GPqPpZ5aLbwb8E6cKvUPM8pcHXXTqLpf5zLAqHP5"
  >;

/** Default BONK/SOL oracle account shipped with the validator script. */
export const BONK_SOL_ORACLE_ADDRESS =
  "6uQ848roY5vumz43QeQguE7xCyBSmgZbwNdJMTrs2Xhy" as Address<
    "6uQ848roY5vumz43QeQguE7xCyBSmgZbwNdJMTrs2Xhy"
  >;
