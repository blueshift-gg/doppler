import {
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  getU64Encoder,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";
import type { ReadonlyUint8Array } from "@solana/codecs-core";
import type { Address } from "@solana/addresses";
import type { KeyPairSigner } from "@solana/signers";

import {
  DopplerTransactionBuilder,
  SOL_USDT_ORACLE_ADDRESS,
  BONK_SOL_ORACLE_ADDRESS,
  SOL_USDC_ORACLE_ADDRESS,
  decodeOracleData,
} from "../index.ts";

import adminKeypair from "../../examples/keys/admin-keypair.json";

export const RPC_URL = "http://127.0.0.1:8899";
export const WS_URL = "ws://127.0.0.1:8900";
export const ORACLE_ADDRESS = SOL_USDC_ORACLE_ADDRESS;

export interface TestContext {
  rpc: RpcClient;
  rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>;
  sendAndConfirmTransaction: ReturnType<typeof sendAndConfirmTransactionFactory>;
  signer: KeyPairSigner;
  priceEncoder: ReturnType<typeof getU64Encoder>;
}

type RpcClient = ReturnType<typeof createSolanaRpc>;

export async function createTestContext(): Promise<TestContext> {
  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });

  const signer = await createKeyPairSignerFromBytes(new Uint8Array(adminKeypair));
  const priceEncoder = getU64Encoder();

  return {
    rpc,
    rpcSubscriptions,
    sendAndConfirmTransaction,
    signer,
    priceEncoder,
  };
}

const PRICE_DECODER = (bytes: ReadonlyUint8Array): bigint =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(0, true);

export async function fetchOracleState<TPayload = bigint>(
  rpc: RpcClient,
  {
    address = SOL_USDC_ORACLE_ADDRESS,
    decodePayload = PRICE_DECODER as (bytes: ReadonlyUint8Array) => TPayload,
  }: {
    address?: Address<string>;
    decodePayload?: (bytes: ReadonlyUint8Array) => TPayload;
  } = {}
): Promise<{
  sequence: bigint;
  payload: TPayload;
}> {
  const accountInfo = await rpc
    .getAccountInfo(address, { encoding: "base64" })
    .send();

  if (!accountInfo.value) {
    throw new Error("Oracle account not found");
  }

  const [rawBytes] = accountInfo.value.data ?? [];
  if (typeof rawBytes !== "string") {
    throw new Error("Unexpected oracle account encoding");
  }

  const buffer = Buffer.from(rawBytes, "base64");
  const decodedBytes = new Uint8Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );

  return decodeOracleData({
    data: decodedBytes,
    decodePayload,
  });
}

export async function submitOracleUpdate(
  ctx: TestContext,
  input: {
    sequence: bigint;
    price: bigint;
    oracleAddress?: Address<string>;
    encodePayload?: (value: bigint) => ReadonlyUint8Array;
    unitPrice?: number | bigint;
  }
): Promise<void> {
  const builder = new DopplerTransactionBuilder(ctx.signer);
  builder.withUnitPrice(input.unitPrice ?? 1_000n);
  builder.addOracleUpdate({
    oracleAddress: input.oracleAddress ?? ORACLE_ADDRESS,
    payload: input.price,
    sequence: input.sequence,
    encodePayload: input.encodePayload ?? ((value) => ctx.priceEncoder.encode(value)),
  });

  const { value: latestBlockhash } = await ctx.rpc.getLatestBlockhash().send();

  const transaction = await builder.build({
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });

  await ctx.sendAndConfirmTransaction(transaction, { commitment: "confirmed" });
  await Bun.sleep(200);
}

export async function submitBatchOracleUpdates(
  ctx: TestContext,
  updates: Array<{
    oracleAddress: Address<string>;
    sequence: bigint;
    price: bigint;
    encodePayload?: (value: bigint) => ReadonlyUint8Array;
  }>,
  options: { unitPrice?: number | bigint } = {}
): Promise<void> {
  const builder = new DopplerTransactionBuilder(ctx.signer);
  builder.withUnitPrice(options.unitPrice ?? 1_000n);

  for (const update of updates) {
    builder.addOracleUpdate({
      oracleAddress: update.oracleAddress,
      sequence: update.sequence,
      payload: update.price,
      encodePayload:
        update.encodePayload ?? ((value) => ctx.priceEncoder.encode(value)),
    });
  }

  const { value: latestBlockhash } = await ctx.rpc.getLatestBlockhash().send();

  const transaction = await builder.build({
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });

  await ctx.sendAndConfirmTransaction(transaction, { commitment: "confirmed" });
  await Bun.sleep(200);
}
