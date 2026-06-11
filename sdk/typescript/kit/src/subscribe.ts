import { deserializeOracle } from "@blueshift-gg/doppler-core";
import type { Oracle, PayloadSerializer } from "@blueshift-gg/doppler-core";
import {
  createSolanaRpcSubscriptions,
  type Address,
  type Commitment,
} from "@solana/kit";
import { decodeBase64AccountData } from "./decode-base64";

type SolanaRpcSubscriptions = ReturnType<typeof createSolanaRpcSubscriptions>;

type AccountNotification = Readonly<{
  value: Readonly<{
    data: readonly [string, string];
  }> | null;
}>;

export type SubscribeToOracleOptions = Readonly<{
  commitment?: Commitment;
}>;

export type OracleSubscription<T> = Readonly<{
  notifications: AsyncIterable<Oracle<T>>;
  unsubscribe: () => void;
}>;

/** Subscribe to live oracle account updates over WebSocket. */
export async function subscribeToOracle<T>(
  rpcSubscriptions: SolanaRpcSubscriptions,
  oraclePubkey: Address,
  serializer: PayloadSerializer<T>,
  options: SubscribeToOracleOptions = {},
): Promise<OracleSubscription<T>> {
  const abortController = new AbortController();
  const { commitment = "confirmed" } = options;

  const accountNotifications = await rpcSubscriptions
    .accountNotifications(oraclePubkey, {
      encoding: "base64",
      commitment,
    })
    .subscribe({ abortSignal: abortController.signal });

  return {
    notifications: mapOracleNotifications(accountNotifications, serializer),
    unsubscribe: () => {
      abortController.abort();
    },
  };
}

async function* mapOracleNotifications<T>(
  notifications: AsyncIterable<AccountNotification>,
  serializer: PayloadSerializer<T>,
): AsyncGenerator<Oracle<T>> {
  for await (const notification of notifications) {
    const accountInfo = notification.value;
    if (!accountInfo) {
      continue;
    }

    const [encodedData] = accountInfo.data;
    yield deserializeOracle(decodeBase64AccountData(encodedData), serializer);
  }
}
