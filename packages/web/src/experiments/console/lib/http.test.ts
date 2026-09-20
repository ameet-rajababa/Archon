import { describe, expect, test, afterEach } from 'bun:test';
import { HttpError, requestJson } from './http';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function reply(body: string, init: { status?: number; type?: string }): void {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(body, {
        status: init.status ?? 200,
        headers: init.type === undefined ? {} : { 'content-type': init.type },
      })
    )) as unknown as typeof fetch;
}

describe('requestJson', () => {
  test('parses a JSON response', async () => {
    reply('{"ok":true}', { type: 'application/json' });
    expect(await requestJson<{ ok: boolean }>('/api/thing')).toEqual({ ok: true });
  });

  test('a 200 of text/html is the SPA fallback, not data', async () => {
    // The exact shape that made a missing route look like an empty state: the
    // server does not route the path, so index.html comes back with a 200.
    reply('<!doctype html><html></html>', { type: 'text/html; charset=utf-8' });
    const err = await requestJson('/api/projects/abc/presentation').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).bodySnippet).toContain('not routed by the server');
    expect((err as HttpError).bodySnippet).toContain('older than this bundle');
  });

  test('names a missing content-type rather than printing "undefined"', async () => {
    reply('nope', {});
    const err = (await requestJson('/api/thing').catch((e: unknown) => e)) as HttpError;
    expect(err.bodySnippet).toContain('no content-type');
  });

  test('a non-2xx still reports its status and body', async () => {
    reply('{"error":"boom"}', { status: 500, type: 'application/json' });
    const err = (await requestJson('/api/thing').catch((e: unknown) => e)) as HttpError;
    expect(err.status).toBe(500);
    expect(err.bodySnippet).toContain('boom');
  });
});
