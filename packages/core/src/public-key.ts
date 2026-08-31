import bs58 from "bs58";

export function decodeSolanaPublicKey(address: string): Uint8Array {
  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(address);
  } catch (error) {
    throw new Error(`Invalid Solana address '${address}': ${(error as Error).message}`);
  }

  if (decoded.length !== 32) {
    throw new Error(
      `Invalid Solana address '${address}': expected 32 bytes, got ${decoded.length}`,
    );
  }

  return decoded;
}
