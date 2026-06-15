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

export function publicKeyToU64Words(address: string): bigint[] {
  const bytes = decodeSolanaPublicKey(address);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [0, 8, 16, 24].map((offset) => view.getBigUint64(offset, true));
}

export function bigintToHexLiteral(value: bigint): string {
  return `0x${value.toString(16).padStart(16, "0")}`;
}
