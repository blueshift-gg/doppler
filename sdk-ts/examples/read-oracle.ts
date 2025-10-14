import { createSolanaRpc } from "@solana/kit";

import { SOL_USDC_ORACLE_ADDRESS, decodeOracleData } from "../index.ts";

const RPC_URL = "http://127.0.0.1:8899";

async function main() {
  const rpc = createSolanaRpc(RPC_URL);

  const accountInfo = await rpc
    .getAccountInfo(SOL_USDC_ORACLE_ADDRESS, { encoding: "base64" })
    .send();

  if (!accountInfo.value) {
    console.log("Oracle account not found");
    return;
  }

  const [rawBytes] = accountInfo.value.data ?? [];
  if (typeof rawBytes !== "string") {
    console.log("Unexpected oracle data encoding");
    return;
  }

  const buffer = Buffer.from(rawBytes, "base64");
  const decoded = decodeOracleData({
    data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    decodePayload: (bytes) =>
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(0, true),
  });

  console.log({
    sequence: decoded.sequence,
    price: decoded.payload,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
