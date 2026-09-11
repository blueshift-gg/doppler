import { expect, test } from 'bun:test';
import type { AccountNotificationsApi, RpcSubscriptions } from '@solana/kit';
import vectors from '../../../doppler/tests/vectors.json' with { type: 'json' };
import { DopplerClient } from '../src/index.js';

const fields = [
  { name: 'price', type: 'i64' },
  { name: 'conf', type: 'u64' },
  { name: 'expo', type: 'i32' },
] as const;

/**
 * What `accountNotifications` yields: the RPC response wrapper, whose `value` is the account. The
 * shape is taken from a live subscription — the client destructures `value` and decodes its data.
 */
const notification = {
  context: { slot: 1n },
  value: { data: [Buffer.from(vectors.price.data, 'hex').toString('base64')], owner: vectors.program },
};

/**
 * The real subscription is an async generator, so this one is too, and it parks after its first
 * value until the signal it was handed aborts. It records that signal so a test can see which one
 * `subscribe` handed over, and whether it aborts.
 */
function notifications() {
  const rpc = { signal: undefined as AbortSignal | undefined };
  async function* stream(signal: AbortSignal) {
    rpc.signal = signal;
    yield notification;
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
  }
  const rpcSubscriptions = {
    accountNotifications: () => ({
      subscribe: async ({ abortSignal }: { abortSignal?: AbortSignal }) => stream(abortSignal!),
    }),
  } as unknown as RpcSubscriptions<AccountNotificationsApi>;
  return { rpcSubscriptions, rpc };
}

const load = () => DopplerClient.load({ admin: vectors.admin, seed: vectors.seed, fields }, { rpc: {} as never, unitPrice: 1 });
const sequence = BigInt(vectors.price.sequence);
/** The payload the vectors' price bytes carry, so a wrongly decoded reading fails here. */
const payload = { price: BigInt(vectors.price.price), conf: BigInt(vectors.price.conf), expo: vectors.price.expo };

test('subscribe stops the RPC when the caller breaks out of the loop', async () => {
  const doppler = await load();
  const { rpcSubscriptions, rpc } = notifications();
  const caller = new AbortController();
  const readings = doppler.subscribe(rpcSubscriptions, { signal: caller.signal });

  await readings.next();
  await readings.return(undefined); // the caller breaks out of the loop

  expect(rpc.signal!.aborted).toBe(true); // breaking out stops the RPC
  expect(caller.signal.aborted).toBe(false); // the caller's signal is left alone
});

test('subscribe gives the RPC a signal of its own', async () => {
  const doppler = await load();
  const { rpcSubscriptions, rpc } = notifications();
  const caller = new AbortController();
  const readings = doppler.subscribe(rpcSubscriptions, { signal: caller.signal });

  const first = await readings.next();

  expect(rpc.signal).not.toBe(caller.signal);
  expect(first.value).toEqual({ sequence, value: payload });
});

test('subscribe forwards the caller abort to the RPC', async () => {
  const doppler = await load();
  const { rpcSubscriptions, rpc } = notifications();
  const caller = new AbortController();
  const readings = doppler.subscribe(rpcSubscriptions, { signal: caller.signal });
  const first = readings.next();
  await first; // the first value, then the stream parks

  caller.abort();
  const reading = await first;

  expect(rpc.signal!.aborted).toBe(true); // the abort reaches the signal the RPC holds
  expect(reading.value).toEqual({ sequence, value: payload });
});

test('subscribe propagates a signal that is already aborted', async () => {
  const doppler = await load();
  const { rpcSubscriptions, rpc } = notifications();
  const caller = new AbortController();
  caller.abort();

  // On an aborted signal a listener never fires, so listening would be both useless and permanent:
  // the test would never run, and nothing would ever remove it. Watch for that.
  const addEventListener = caller.signal.addEventListener.bind(caller.signal);
  const attached: string[] = [];
  caller.signal.addEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    attached.push(type);
    return addEventListener(type, listener, options);
  };

  const readings = doppler.subscribe(rpcSubscriptions, { signal: caller.signal });
  await readings.next();

  expect(rpc.signal!.aborted).toBe(true);
  expect(attached).toEqual([]);
});

test('subscribe owns a signal even with no caller signal', async () => {
  const doppler = await load();
  const { rpcSubscriptions, rpc } = notifications();
  const readings = doppler.subscribe(rpcSubscriptions);

  await readings.next();
  await readings.return(undefined);

  expect(rpc.signal!.aborted).toBe(true);
});
