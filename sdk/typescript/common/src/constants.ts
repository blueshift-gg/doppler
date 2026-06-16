/** Compute units consumed by a sequence check. */
export const SEQUENCE_CHECK_CU = 5;

/** Compute units consumed by admin verification. */
export const ADMIN_VERIFICATION_CU = 6;

/** Compute units consumed by writing the payload. */
export const PAYLOAD_WRITE_CU = 6;

/** Base compute units for a compute-budget instruction. */
export const COMPUTE_BUDGET_IX_CU = 150;

/** Account data size for a compute-unit-price instruction. */
export const COMPUTE_BUDGET_UNIT_PRICE_SIZE = 9;

/** Account data size for a compute-unit-limit instruction. */
export const COMPUTE_BUDGET_UNIT_LIMIT_SIZE = 5;

/** Account data size for a loaded-accounts-data-size-limit instruction. */
export const COMPUTE_BUDGET_DATA_LIMIT_SIZE = 5;

/** Account data size for the compute-budget program. */
export const COMPUTE_BUDGET_PROGRAM_SIZE = 22;

/** Account data size for the oracle program. */
export const ORACLE_PROGRAM_SIZE = 36;
