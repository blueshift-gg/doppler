import { beforeAll, describe, expect, test } from "bun:test";

import {
  createTestContext,
  fetchOracleState,
  submitBatchOracleUpdates,
  submitOracleUpdate,
} from "./helpers.ts";
import {
  BONK_SOL_ORACLE_ADDRESS,
  DopplerTransactionBuilder,
  SOL_USDC_ORACLE_ADDRESS,
  SOL_USDT_ORACLE_ADDRESS,
} from "../index.ts";
import type { ReadonlyUint8Array } from "@solana/codecs-core";

let ctx: Awaited<ReturnType<typeof createTestContext>>;

beforeAll(async () => {
  ctx = await createTestContext();
});

describe("Doppler SDK integration", () => {
  test(
    "writes the oracle price with a fresh sequence",
    async () => {
      const current = await fetchOracleState(ctx.rpc);
      const newSequence = current.sequence + 1n;
      const newPrice = current.payload + 1_000_000n;

      await submitOracleUpdate(ctx, {
        sequence: newSequence,
        price: newPrice,
      });

      const updated = await fetchOracleState(ctx.rpc);

      expect(updated.sequence).toBe(newSequence);
      expect(updated.payload).toBe(newPrice);
    },
    { timeout: 30_000 }
  );

  test(
    "rejects stale oracle sequences",
    async () => {
      const current = await fetchOracleState(ctx.rpc);

      await expect(
        submitOracleUpdate(ctx, {
          sequence: current.sequence,
          price: current.payload + 500_000n,
        })
      ).rejects.toThrow("Transaction simulation failed");
    },
    { timeout: 30_000 }
  );

  test(
    "updates multiple oracles in a single transaction",
    async () => {
      const usdcBefore = await fetchOracleState(ctx.rpc, {
        address: SOL_USDC_ORACLE_ADDRESS,
      });
      const usdtBefore = await fetchOracleState(ctx.rpc, {
        address: SOL_USDT_ORACLE_ADDRESS,
      });

      const baseSequence = BigInt(Date.now());

      await submitBatchOracleUpdates(
        ctx,
        [
          {
            oracleAddress: SOL_USDC_ORACLE_ADDRESS,
            sequence: baseSequence,
            price: usdcBefore.payload + 2_000_000n,
          },
          {
            oracleAddress: SOL_USDT_ORACLE_ADDRESS,
            sequence: baseSequence + 1n,
            price: usdtBefore.payload + 3_000_000n,
          },
        ],
        { unitPrice: 2_000n }
      );

      const usdcAfter = await fetchOracleState(ctx.rpc, {
        address: SOL_USDC_ORACLE_ADDRESS,
      });
      const usdtAfter = await fetchOracleState(ctx.rpc, {
        address: SOL_USDT_ORACLE_ADDRESS,
      });

      expect(usdcAfter.sequence).toBe(baseSequence);
      expect(usdcAfter.payload).toBe(usdcBefore.payload + 2_000_000n);
      expect(usdtAfter.sequence).toBe(baseSequence + 1n);
      expect(usdtAfter.payload).toBe(usdtBefore.payload + 3_000_000n);
    },
    { timeout: 30_000 }
  );

  test(
    "accepts non-consecutive sequence numbers",
    async () => {
      const current = await fetchOracleState(ctx.rpc, {
        address: SOL_USDC_ORACLE_ADDRESS,
      });

      const newSequence = current.sequence + 10n;
      const newPrice = current.payload + 4_000_000n;

      await submitOracleUpdate(ctx, {
        sequence: newSequence,
        price: newPrice,
      });

      const updated = await fetchOracleState(ctx.rpc);
      expect(updated.sequence).toBe(newSequence);
      expect(updated.payload).toBe(newPrice);
    },
    { timeout: 30_000 }
  );

  test(
    "fails when updating an unknown oracle",
    async () => {
      const current = await fetchOracleState(ctx.rpc);

      await expect(
        submitOracleUpdate(ctx, {
          oracleAddress: ctx.signer.address,
          sequence: current.sequence + 1n,
          price: current.payload + 100n,
        })
      ).rejects.toThrow(/Transaction simulation failed/);
    },
    { timeout: 30_000 }
  );

  test(
    "supports custom payload encoders and decoders",
    async () => {
      type MarketData = { price: number; confidenceBps: number };

      const encodeMarketData = (value: MarketData) => {
        const buffer = new ArrayBuffer(8);
        const view = new DataView(buffer);
        view.setUint32(0, value.price, true);
        view.setUint32(4, value.confidenceBps, true);
        return new Uint8Array(buffer);
      };

      const decodeMarketData = (bytes: ReadonlyUint8Array): MarketData => {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return {
          price: view.getUint32(0, true),
          confidenceBps: view.getUint32(4, true),
        } satisfies MarketData;
      };

      const sequence = BigInt(Date.now());
      const payload: MarketData = {
        price: 150_000,
        confidenceBps: 25,
      };

      const builder = new DopplerTransactionBuilder(ctx.signer);
      builder.withUnitPrice(1_000n).addOracleUpdate({
        oracleAddress: BONK_SOL_ORACLE_ADDRESS,
        sequence,
        payload,
        encodePayload: encodeMarketData,
      });

      const { value: latestBlockhash } = await ctx.rpc.getLatestBlockhash().send();
      const transaction = await builder.build({
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      });

      await ctx.sendAndConfirmTransaction(transaction, { commitment: "confirmed" });
      await Bun.sleep(200);

      const state = await fetchOracleState(ctx.rpc, {
        address: BONK_SOL_ORACLE_ADDRESS,
        decodePayload: decodeMarketData,
      });

      expect(state.sequence).toBe(sequence);
      expect(state.payload).toEqual(payload);
    },
    { timeout: 30_000 }
  );

  test(
    "handles concurrent submissions",
    async () => {
      const usdc = await fetchOracleState(ctx.rpc, {
        address: SOL_USDC_ORACLE_ADDRESS,
      });
      const usdt = await fetchOracleState(ctx.rpc, {
        address: SOL_USDT_ORACLE_ADDRESS,
      });

      const usdcUpdate = submitOracleUpdate(ctx, {
        oracleAddress: SOL_USDC_ORACLE_ADDRESS,
        sequence: usdc.sequence + 1n,
        price: usdc.payload + 5_000_000n,
      });

      const usdtUpdate = submitOracleUpdate(ctx, {
        oracleAddress: SOL_USDT_ORACLE_ADDRESS,
        sequence: usdt.sequence + 1n,
        price: usdt.payload + 6_000_000n,
      });

      await Promise.all([usdcUpdate, usdtUpdate]);

      const updatedUsdc = await fetchOracleState(ctx.rpc, {
        address: SOL_USDC_ORACLE_ADDRESS,
      });
      const updatedUsdt = await fetchOracleState(ctx.rpc, {
        address: SOL_USDT_ORACLE_ADDRESS,
      });

      expect(updatedUsdc.sequence).toBe(usdc.sequence + 1n);
      expect(updatedUsdc.payload).toBe(usdc.payload + 5_000_000n);
      expect(updatedUsdt.sequence).toBe(usdt.sequence + 1n);
      expect(updatedUsdt.payload).toBe(usdt.payload + 6_000_000n);
    },
    { timeout: 30_000 }
  );
});
