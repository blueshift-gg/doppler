import {
  address,
  createSolanaRpc,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";

import { decodeBase64AccountData } from "./decode-base64";

const BPF_LOADER_UPGRADEABLE_PROGRAM_ADDRESS = address(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

type SolanaRpc = ReturnType<typeof createSolanaRpc>;

export async function deriveProgramDataAddress(programAddress: Address): Promise<Address> {
  const addressEncoder = getAddressEncoder();
  const [programDataAddress] = await getProgramDerivedAddress({
    programAddress: BPF_LOADER_UPGRADEABLE_PROGRAM_ADDRESS,
    seeds: [addressEncoder.encode(programAddress)],
  });
  return programDataAddress;
}

export async function fetchProgramDataAccountSize(
  rpc: SolanaRpc,
  programAddress: Address,
): Promise<number> {
  const programDataAddress = await deriveProgramDataAddress(programAddress);
  const { value: accountInfo } = await rpc
    .getAccountInfo(programDataAddress, { encoding: "base64" })
    .send();
  if (!accountInfo) {
    throw new Error(`Program data account not found for program ${programAddress}`);
  }

  const [encodedData] = accountInfo.data;
  return decodeBase64AccountData(encodedData).length;
}

export async function getAveragePriorityFee(
  rpc: SolanaRpc,
  writableAccounts: readonly Address[],
): Promise<bigint> {
  const fees = await rpc.getRecentPrioritizationFees([...writableAccounts]).send();
  if (fees.length === 0) {
    return 0n;
  }

  const total = fees.reduce(
    (sum, fee) => sum + BigInt(fee.prioritizationFee as bigint | number),
    0n,
  );
  return total / BigInt(fees.length);
}
