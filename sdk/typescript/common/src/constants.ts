/** Compute units consumed by a sequence check. */
export const SEQUENCE_CHECK_CU = 5;

/** Compute units consumed by admin verification. */
export const ADMIN_VERIFICATION_CU = 6;

/** Compute units consumed by writing the payload. */
export const PAYLOAD_WRITE_CU = 6;

/** Base compute units for a compute-budget instruction. */
export const COMPUTE_BUDGET_IX_CU = 150;

/** Account data size for the compute-budget program. */
export const COMPUTE_BUDGET_PROGRAM_SIZE = 22;

/** Account data size for a LoaderV3 program account. */
export const PROGRAM_ACCOUNT_SIZE = 36;

/** LoaderV3 programdata ELF header size. */
export const ELF_HEADER_SIZE = 45;

/** Per-account metadata cost under SIMD-0186. */
export const ACCOUNT_METADATA_SIZE = 64;
