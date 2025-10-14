import {
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  getU64Encoder,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";

import {
  DopplerTransactionBuilder,
  SOL_USDC_ORACLE_ADDRESS,
} from "../index.ts";

import adminKeypair from "../../examples/keys/admin-keypair.json";

const RPC_URL = "http://127.0.0.1:8899";
const WS_URL = "ws://127.0.0.1:8900";

async function main() {
  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });

  const signer = await createKeyPairSignerFromBytes(new Uint8Array(adminKeypair));
  const encodePrice = getU64Encoder();

  const builder = new DopplerTransactionBuilder(signer);
  builder.withUnitPrice(1_000n).addOracleUpdate({
    oracleAddress: SOL_USDC_ORACLE_ADDRESS,
    sequence: BigInt(Date.now()),
    payload: 123_456_789n,
    encodePayload: (value) => encodePrice.encode(value),
  });

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const transaction = await builder.build({
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });

  await sendAndConfirmTransaction(transaction, { commitment: "confirmed" });

  console.log("Oracle update sent", transaction);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
