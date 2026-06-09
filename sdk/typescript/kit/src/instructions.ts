import {
  oracleAccountSize,
  serializeOracle,
} from "@blueshift-gg/doppler-core";
import type { Oracle, PayloadSerializer } from "@blueshift-gg/doppler-core";
import {
  AccountRole,
  type Address,
  type Instruction,
} from "@solana/kit";

export function createOracleUpdateInstruction<T>(
  programId: Address,
  admin: Address,
  oraclePubkey: Address,
  oracle: Oracle<T>,
  serializer: PayloadSerializer<T>,
): Instruction {
  return {
    programAddress: programId,
    accounts: [
      { address: admin, role: AccountRole.READONLY_SIGNER },
      { address: oraclePubkey, role: AccountRole.WRITABLE },
    ],
    data: serializeOracle(oracle, serializer),
  };
}

export { oracleAccountSize };
