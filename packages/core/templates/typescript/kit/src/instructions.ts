import { oracleAccountSize, serializeOracle } from "@blueshift-gg/doppler-common";
import type { Oracle, FixedSizeCodec } from "@blueshift-gg/doppler-common";
import { AccountRole, type Address, type Instruction } from "@solana/kit";

export function createOracleUpdateInstruction<T>(
  programId: Address,
  admin: Address,
  oraclePubkey: Address,
  oracle: Oracle<T>,
  payloadCodec: FixedSizeCodec<T>,
): Instruction {
  return {
    programAddress: programId,
    accounts: [
      { address: admin, role: AccountRole.READONLY_SIGNER },
      { address: oraclePubkey, role: AccountRole.WRITABLE },
    ],
    data: serializeOracle(oracle, payloadCodec),
  };
}

export { oracleAccountSize };
