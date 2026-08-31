import { Address, LoaderV3Program, type Connection } from "@solana/web3.js";

export async function deriveProgramDataAddress(programId: Address): Promise<Address> {
  const [programDataAddress] = await Address.findProgramAddress(
    [programId.toBytes()],
    LoaderV3Program.programId,
  );
  return programDataAddress;
}

export async function fetchProgramDataAccountSize(
  connection: Connection,
  programId: Address,
): Promise<number> {
  const programDataAddress = await deriveProgramDataAddress(programId);
  const accountInfo = await connection.getAccountInfo(programDataAddress);
  if (!accountInfo?.data) {
    throw new Error(`Program data account not found for program ${programId.toBase58()}`);
  }

  return accountInfo.data.length;
}

export async function getAveragePriorityFee(
  connection: Connection,
  writableAccounts: readonly Address[],
): Promise<bigint> {
  const fees = await connection.getRecentPrioritizationFees({
    lockedWritableAccounts: [...writableAccounts],
  });
  if (fees.length === 0) {
    return 0n;
  }

  const total = fees.reduce((sum, fee) => sum + BigInt(fee.prioritizationFee), 0n);
  return total / BigInt(fees.length);
}
