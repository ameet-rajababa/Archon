/**
 * The deploy destroys whatever the container is holding, so these tests are
 * about one direction of failure: this must never report a quiet moment that
 * is not one. A wrong "busy" costs a wait; a wrong "quiet" costs somebody's
 * turn.
 */
import { describe, expect, test, afterEach } from 'bun:test';
import {
  busyReason,
  settingsFromEnv,
  waitForTurnGap,
  TURN_GAP_DEFAULTS,
  TURN_GAP_QUIET,
  TURN_GAP_TIMED_OUT,
  TURN_GAP_UNREADABLE,
} from './turn-gap';

const quiet = {
  concurrency: { active: 0, queuedTotal: 0, activeTools: {} },
  runningWorkflows: 0,
};

/** The shape /api/health actually returns, taken from a live box mid-turn. */
const busy = {
  concurrency: {
    active: 3,
    queuedTotal: 0,
    activeConversationIds: ['web-a', 'web-b', 'ea65614a'],
    activeTools: {
      'web-a': { name: 'Bash', input: { command: 'ls' } },
      'web-b': { name: 'Edit', input: {} },
    },
  },
  runningWorkflows: 1,
};

describe('busyReason', () => {
  test('an idle box is a moment to swap', () => {
    expect(busyReason(quiet)).toBeNull();
  });

  test('names what is holding the deploy up, tools included', () => {
    const reason = busyReason(busy);
    expect(reason).toContain('3 chats mid-turn');
    expect(reason).toContain('Bash');
    expect(reason).toContain('Edit');
    expect(reason).toContain('1 workflow run executing');
  });

  test('counts queued messages, which a restart drops just as surely', () => {
    expect(busyReason({ ...quiet, concurrency: { ...quiet.concurrency, queuedTotal: 2 } })).toBe(
      '2 messages queued'
    );
  });

  test('a workflow run alone is enough to wait, since a killed run comes back stuck', () => {
    expect(busyReason({ ...quiet, runningWorkflows: 1 })).toBe('1 workflow run executing');
  });

  test('singular and plural both read as English', () => {
    expect(busyReason({ ...quiet, concurrency: { ...quiet.concurrency, active: 1 } })).toBe(
      '1 chat mid-turn'
    );
  });

  test('a chat with no tool in flight still counts', () => {
    const thinking = { ...quiet, concurrency: { active: 1, queuedTotal: 0, activeTools: {} } };
    expect(busyReason(thinking)).toBe('1 chat mid-turn');
  });

  // The whole point. Every one of these used to be a plausible way to read
  // "zero" out of a payload that never said zero.
  test.each([
    ['no concurrency block', { runningWorkflows: 0 }],
    ['no active count', { concurrency: { queuedTotal: 0 }, runningWorkflows: 0 }],
    ['no queued count', { concurrency: { active: 0 }, runningWorkflows: 0 }],
    ['no workflow count', { concurrency: { active: 0, queuedTotal: 0 } }],
    ['active is a string', { concurrency: { active: '0', queuedTotal: 0 }, runningWorkflows: 0 }],
    ['not an object at all', 'ok'],
    ['null', null],
  ])('refuses to call it quiet when the payload has %s', (_label, payload) => {
    expect(() => busyReason(payload)).toThrow();
  });
});

describe('settingsFromEnv', () => {
  test('an empty environment is the documented default', () => {
    expect(settingsFromEnv({})).toEqual(TURN_GAP_DEFAULTS);
  });

  test('the deploy can tune every knob', () => {
    expect(
      settingsFromEnv({
        HEALTH_URL: 'http://app:4000/api/health',
        TURN_GAP_TIMEOUT: '60',
        TURN_GAP_INTERVAL: '1',
        TURN_GAP_CONFIRM: '0',
      })
    ).toEqual({
      healthUrl: 'http://app:4000/api/health',
      timeoutSeconds: 60,
      intervalSeconds: 1,
      confirmSeconds: 0,
    });
  });

  test('a nonsense timeout stops the deploy rather than silently defaulting', () => {
    expect(() => settingsFromEnv({ TURN_GAP_TIMEOUT: 'soon' })).toThrow(/TURN_GAP_TIMEOUT/);
  });
});

describe('waitForTurnGap', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /**
   * The one assertion in this file. `typeof fetch` carries statics (Bun adds
   * `preconnect`) that a bare handler cannot satisfy, so the substitution is
   * made once here rather than at each call site.
   */
  function installFetch(handler: () => Promise<Response>): void {
    globalThis.fetch = handler as unknown as typeof fetch;
  }

  /** Answers each call with the next payload, repeating the last one forever. */
  function serve(payloads: readonly unknown[]): () => number {
    let calls = 0;
    installFetch(() => {
      const payload = payloads[Math.min(calls, payloads.length - 1)];
      calls++;
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
    });
    return () => calls;
  }

  const fast = { ...TURN_GAP_DEFAULTS, timeoutSeconds: 1, intervalSeconds: 0, confirmSeconds: 0 };
  const lines: string[] = [];
  const log = (line: string): void => {
    lines.push(line);
  };

  test('two quiet readings in a row is the go-ahead', async () => {
    serve([quiet]);
    expect(await waitForTurnGap(fast, log)).toBe(TURN_GAP_QUIET);
  });

  test('a turn starting between the two readings is not a gap', async () => {
    // Quiet, then busy on the confirming read — exactly the race the second
    // reading exists to catch. It must not return QUIET on that first sight.
    const calls = serve([quiet, busy]);
    expect(await waitForTurnGap({ ...fast, timeoutSeconds: 0 }, log)).toBe(TURN_GAP_TIMED_OUT);
    expect(calls()).toBeGreaterThanOrEqual(2);
  });

  test('a box that is never quiet times out instead of swapping anyway', async () => {
    serve([busy]);
    expect(await waitForTurnGap({ ...fast, timeoutSeconds: 0 }, log)).toBe(TURN_GAP_TIMED_OUT);
  });

  test('a health endpoint that cannot be reached stops the deploy', async () => {
    installFetch(() => Promise.reject(new Error('connection refused')));
    expect(await waitForTurnGap(fast, log)).toBe(TURN_GAP_UNREADABLE);
  });

  test('a 503 from health is unreadable, not quiet', async () => {
    installFetch(() => Promise.resolve(new Response('unavailable', { status: 503 })));
    expect(await waitForTurnGap(fast, log)).toBe(TURN_GAP_UNREADABLE);
  });

  test('it reports a reason once, not once per poll', async () => {
    lines.length = 0;
    // The same reason three polls running, then quiet. Thirty minutes of this
    // at five-second intervals is what would bury the line that matters.
    serve([busy, busy, busy, quiet]);
    expect(await waitForTurnGap(fast, log)).toBe(TURN_GAP_QUIET);
    const waiting = lines.filter(line => line.startsWith('waiting:'));
    expect(waiting).toEqual(['waiting: 3 chats mid-turn (Bash, Edit), 1 workflow run executing']);
    expect(lines.at(-1)).toBe('quiet — nothing is mid-flight');
  });
});
