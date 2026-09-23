import { describe, test, expect } from 'bun:test';
import {
  recoverOnReconnect,
  conversationStreamKeys,
  runStreamKeys,
  type OpenableStream,
} from './sse';
import { subscribeKey, get } from '../store/cache';
import { K } from '../store/keys';

// Keys are module-level in the store, so every test uses its own.

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Stands in for the EventSource slice `recoverOnReconnect` drives. `open()`
 * fires what the browser fires on a fresh connection — including the automatic
 * reconnect after a gap, which is the case under test.
 */
function fakeStream(): { stream: OpenableStream; open: () => void } {
  const stream: OpenableStream = { onopen: null };
  return {
    stream,
    open: (): void => {
      stream.onopen?.(new Event('open'));
    },
  };
}

describe('recoverOnReconnect', () => {
  test('skips the first open and refetches on every one after it', async () => {
    const key = 'test-sse:skip-first-open';
    let loads = 0;
    const unsubscribe = subscribeKey(
      key,
      () => {},
      () => {
        loads += 1;
        return Promise.resolve(`v${loads.toString()}`);
      }
    );
    await flush();
    expect(loads).toBe(1);

    const { stream, open } = fakeStream();
    recoverOnReconnect(stream, [key]);

    open(); // the connection this mount opened — it already fetched
    await flush();
    expect(loads).toBe(1);

    open(); // dropped and came back: everything emitted in the gap is lost
    await flush();
    expect(loads).toBe(2);

    open(); // a second gap recovers too — the skip is not a one-shot latch
    await flush();
    expect(loads).toBe(3);

    unsubscribe();
  });

  test('recovers a key whose value is still inside the staleness window', async () => {
    // The window governs subscribe; a reconnect gap is evidence of loss, so it
    // refetches regardless of how recently the value landed.
    const key = 'test-sse:ignores-staleness';
    let loads = 0;
    const unsubscribe = subscribeKey(
      key,
      () => {},
      () => {
        loads += 1;
        return Promise.resolve('v');
      }
    );
    await flush();

    const { stream, open } = fakeStream();
    recoverOnReconnect(stream, [key]);
    open();
    open();
    await flush();

    expect(loads).toBe(2);
    unsubscribe();
  });
});

describe('stream recovery — the keys each stream keeps live', () => {
  test("a conversation stream's reconnect refetches its messages", async () => {
    const conversationId = 'test-sse-conversation';
    const key = K.messages(conversationId);
    let loads = 0;
    const unsubscribe = subscribeKey(
      key,
      () => {},
      () => {
        loads += 1;
        return Promise.resolve([`m${loads.toString()}`]);
      }
    );
    await flush();
    expect(loads).toBe(1);

    const { stream, open } = fakeStream();
    recoverOnReconnect(stream, conversationStreamKeys(conversationId));

    open();
    await flush();
    expect(loads).toBe(1);

    open();
    await flush();
    expect(loads).toBe(2);
    expect(get(key)).toEqual(['m2']); // the transcript is current again
    expect(get(key)).not.toBeUndefined(); // and was never blanked to get there

    unsubscribe();
  });

  test("a run stream's reconnect refetches its messages and its run detail", async () => {
    const conversationId = 'test-sse-run-conversation';
    const runId = 'test-sse-run';
    let messageLoads = 0;
    let runLoads = 0;

    const unsubscribeMessages = subscribeKey(
      K.messages(conversationId),
      () => {},
      () => {
        messageLoads += 1;
        return Promise.resolve('messages');
      }
    );
    const unsubscribeRun = subscribeKey(
      K.run(runId),
      () => {},
      () => {
        runLoads += 1;
        return Promise.resolve('run');
      }
    );
    await flush();
    expect([messageLoads, runLoads]).toEqual([1, 1]);

    const { stream, open } = fakeStream();
    recoverOnReconnect(stream, runStreamKeys(conversationId, runId));

    open();
    await flush();
    expect([messageLoads, runLoads]).toEqual([1, 1]);

    open();
    await flush();
    expect([messageLoads, runLoads]).toEqual([2, 2]);

    unsubscribeMessages();
    unsubscribeRun();
  });
});
