import { describe, test, expect, afterEach } from 'bun:test';
import { listRuns } from './runs';

const EMPTY_FEED = JSON.stringify({ runs: [], total: 0, counts: {} });

describe('listRuns — query-string filters', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** Captures the URL `listRuns` requests, with a well-formed empty feed back. */
  function captureUrl(): { get: () => string } {
    let seen = '';
    globalThis.fetch = ((input: RequestInfo | URL) => {
      seen = String(input);
      return Promise.resolve(
        new Response(EMPTY_FEED, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }) as typeof fetch;
    return { get: () => seen };
  }

  test('forwards parentConversationId so the chat filter runs in SQL, not the browser', async () => {
    const captured = captureUrl();

    await listRuns({ parentConversationId: 'chat-conv-db-id' });

    expect(captured.get()).toBe('/api/dashboard/runs?parentConversationId=chat-conv-db-id');
  });

  test('composes the chat filter with the existing codebase, status and limit filters', async () => {
    const captured = captureUrl();

    await listRuns({
      codebaseId: 'cb-1',
      parentConversationId: 'chat-conv-db-id',
      status: 'completed',
      limit: 25,
    });

    const query = new URLSearchParams(captured.get().split('?')[1]);
    expect(Object.fromEntries(query)).toEqual({
      codebaseId: 'cb-1',
      parentConversationId: 'chat-conv-db-id',
      status: 'completed',
      limit: '25',
    });
  });

  test('omits the chat filter entirely when unset — the unfiltered feed is unchanged', async () => {
    const captured = captureUrl();

    await listRuns({ codebaseId: 'cb-1' });

    expect(captured.get()).toBe('/api/dashboard/runs?codebaseId=cb-1');
  });
});
