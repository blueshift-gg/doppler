import { deserializeOracle } from "@blueshift-gg/doppler-core";
import type { Oracle, PayloadSerializer } from "@blueshift-gg/doppler-core";
import type { AccountInfoWithSpace, Address, Commitment, Connection } from "@solana/web3.js";

export type SubscribeToOracleOptions = Readonly<{
  commitment?: Commitment;
}>;

export type OracleSubscription<T> = Readonly<{
  notifications: AsyncIterable<Oracle<T>>;
  unsubscribe: () => Promise<void>;
}>;

/** Subscribe to live oracle account updates over WebSocket. */
export function subscribeToOracle<T>(
  connection: Connection,
  oraclePubkey: Address,
  serializer: PayloadSerializer<T>,
  options: SubscribeToOracleOptions = {},
): OracleSubscription<T> {
  const { commitment = "confirmed" } = options;
  let resolvePending: ((result: IteratorResult<Oracle<T>>) => void) | null = null;
  const queue: Oracle<T>[] = [];
  let closed = false;

  const subscriptionId = connection.onAccountChange(
    oraclePubkey,
    (accountInfo: AccountInfoWithSpace<Uint8Array>) => {
      const oracle = deserializeOracle(accountInfo.data, serializer);
      if (resolvePending) {
        const resolve = resolvePending;
        resolvePending = null;
        resolve({ value: oracle, done: false });
        return;
      }

      queue.push(oracle);
    },
    commitment,
  );

  const notifications: AsyncIterable<Oracle<T>> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<Oracle<T>>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }

          if (closed) {
            return Promise.resolve({ value: undefined, done: true });
          }

          return new Promise((resolve) => {
            resolvePending = resolve;
          });
        },
      };
    },
  };

  return {
    notifications,
    unsubscribe: async () => {
      closed = true;
      if (resolvePending) {
        resolvePending({ value: undefined, done: true });
        resolvePending = null;
      }

      await connection.removeAccountChangeListener(subscriptionId);
    },
  };
}
