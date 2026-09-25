import { describe, test, expect } from 'bun:test';
import {
  recoverOnReconnect,
  conversationStreamKeys,
  runStreamKeys,
  dashboardStreamKeys,
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

  /**
   * The dashboard stream is the one that feeds the rail. Its keys are FAMILY
   * prefixes rather than concrete ids — it is multiplexed across every project
   * — so these drive real per-project keys and prove the prefix reaches them.
   */
  test('the first dashboard open does not invalidate; the second and third do', async () => {
    const projectId = 'test-sse-dash-first-open';
    const key = K.projectCounts(projectId);
    let loads = 0;

    const unsubscribe = subscribeKey(
      key,
      () => {},
      () => {
        loads += 1;
        return Promise.resolve({ chats: loads });
      }
    );
    await flush();
    expect(loads).toBe(1);

    const { stream, open } = fakeStream();
    recoverOnReconnect(stream, dashboardStreamKeys());

    // The mount that opened the stream already fetched. Invalidating here
    // would double every request on page load.
    open();
    await flush();
    expect(loads).toBe(1);

    open();
    await flush();
    expect(loads).toBe(2);

    open();
    await flush();
    expect(loads).toBe(3);
    // Stale-while-revalidate: the visible number was never blanked to refresh.
    expect(get(key)).toEqual({ chats: 3 });

    unsubscribe();
  });

  test("a dashboard reconnect refetches the dashboard's own keys", async () => {
    const projectId = 'test-sse-dash-keys';
    const runId = 'test-sse-dash-unrelated-run';
    const watched = {
      counts: K.projectCounts(projectId),
      conversations: K.conversations(projectId),
      runs: K.runs(projectId),
      global: K.countsGlobal,
      chats: K.activeChats,
    };
    const loads: Record<string, number> = {};
    const unsubscribes = Object.values(watched).map(key => {
      loads[key] = 0;
      return subscribeKey(
        key,
        () => {},
        () => {
          loads[key] = (loads[key] ?? 0) + 1;
          return Promise.resolve(key);
        }
      );
    });
    // A run detail is NOT this stream's to recover: a reconnect cannot know
    // which runs moved while the socket was down, and useRunStreamSSE — which
    // does know — recovers it.
    let runDetailLoads = 0;
    const unsubscribeRun = subscribeKey(
      K.run(runId),
      () => {},
      () => {
        runDetailLoads += 1;
        return Promise.resolve('run');
      }
    );
    await flush();
    expect(Object.values(loads)).toEqual([1, 1, 1, 1, 1]);
    expect(runDetailLoads).toBe(1);

    const { stream, open } = fakeStream();
    recoverOnReconnect(stream, dashboardStreamKeys());
    open(); // first open — the mount's own fetch
    open(); // the reconnect
    await flush();

    // Every column the rail draws, plus the global running pill, which the
    // live path had stopped naming while the reconnect list still did.
    expect(Object.values(loads)).toEqual([2, 2, 2, 2, 2]);
    expect(runDetailLoads).toBe(1);

    for (const unsubscribe of unsubscribes) unsubscribe();
    unsubscribeRun();
  });
});
