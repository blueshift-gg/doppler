import { expect, test } from 'bun:test';
import type { Connection } from '@solana/web3.js';
import vectors from '../../../doppler/tests/vectors.json' with { type: 'json' };
import { DopplerClient } from '../src/index.js';

const fields = [
  { name: 'price', type: 'i64' },
  { name: 'conf', type: 'u64' },
  { name: 'expo', type: 'i32' },
] as const;

const account = { data: Uint8Array.from(Buffer.from(vectors.price.data, 'hex')), owner: { toString: () => vectors.program } };

/**
 * A `Connection` whose account listener is registered when the subscription is created, as the real
 * one is, so a test can push a change without waiting for the client to pull. The client queues
 * what it receives, as it does over a socket, so pushing before it asks is not a race.
 */
function connection() {
  const changes = {
    added: 0,
    removed: 0,
    onChange: undefined as undefined | ((account: unknown) => void),
    /** Pushes a changed account to the listener, as the socket would. */
    push: (account: unknown) => changes.onChange!(account),
  };
  const rpc = {
    onAccountChange: (_address: unknown, onChange: (account: unknown) => void) => {
      changes.added++;
      changes.onChange = onChange;
      return 1;
    },
    removeAccountChangeListener: async () => {
      changes.removed++;
    },
  } as unknown as Connection;
  return { rpc, changes };
}

/** Counts the abort listeners attached to a signal, so a leak is directly observable. */
function watchedSignal() {
  const controller = new AbortController();
  const listeners = { added: 0, removed: 0 };
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if (type === 'abort') listeners.added++;
    return add(type, listener, options);
  };
  controller.signal.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
    if (type === 'abort') listeners.removed++;
    return remove(type, listener, options);
  };
  return { controller, listeners };
}

const load = (rpc: Connection) => DopplerClient.load({ admin: vectors.admin, seed: vectors.seed, fields }, { rpc, unitPrice: 1 });
const sequence = BigInt(vectors.price.sequence);
/** The payload the vectors' price bytes carry, so a wrongly decoded reading fails here. */
const payload = { price: BigInt(vectors.price.price), conf: BigInt(vectors.price.conf), expo: vectors.price.expo };

test('subscribe detaches its listener when the caller breaks out of the loop', async () => {
  const { rpc, changes } = connection();
  const doppler = await load(rpc);
  const { controller, listeners } = watchedSignal();
  const readings = doppler.subscribe({ signal: controller.signal });

  const pending = readings.next();
  changes.push(account);
  await pending;
  await readings.return(undefined);

  expect(changes.added).toBe(1);
  expect(listeners.removed).toBe(1);
  expect(changes.removed).toBe(1);
});

test('subscribe decodes what the account listener delivers', async () => {
  const { rpc, changes } = connection();
  const doppler = await load(rpc);
  const { controller, listeners } = watchedSignal();
  const readings = doppler.subscribe({ signal: controller.signal });

  const pending = readings.next();
  changes.push(account);
  const reading = await pending;

  expect(reading.value).toEqual({ sequence, value: payload });
  expect(changes.added).toBe(1);
  expect(listeners.added).toBe(1);
});

test('one signal reused across subscriptions does not accumulate abort listeners', async () => {
  const { rpc, changes } = connection();
  const doppler = await load(rpc);
  const { controller, listeners } = watchedSignal();

  for (let i = 0; i < 3; i++) {
    const readings = doppler.subscribe({ signal: controller.signal });
    const pending = readings.next();
    changes.push(account);
    await pending;
    await readings.return(undefined);
  }

  expect(listeners.added).toBe(3);
  expect(listeners.removed).toBe(3); // every one is removed, so nothing accumulates
  expect(changes.added).toBe(3);
  expect(changes.removed).toBe(3);
});

test('aborting the signal wakes the loop and detaches', async () => {
  const { rpc, changes } = connection();
  const doppler = await load(rpc);
  const { controller } = watchedSignal();
  const readings = doppler.subscribe({ signal: controller.signal });

  const first = readings.next();
  changes.push(account);
  await first;

  controller.abort();
  const ended = await readings.next();

  expect(ended.done).toBe(true);
  expect(changes.removed).toBe(1);
});
