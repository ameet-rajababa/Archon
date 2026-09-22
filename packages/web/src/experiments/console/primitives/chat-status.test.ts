import { describe, expect, test } from 'bun:test';
import { askAwaitingIds, awaitingInputIds, awaitingReplyIds, chatStatus } from './chat-status';

const sets = (working: string[], awaiting: string[]) => ({
  working: new Set(working),
  awaiting: new Set(awaiting),
});

describe('chatStatus', () => {
  test('awaiting outranks working — the half that needs a human wins', () => {
    expect(chatStatus('a', sets(['a'], ['a']))).toBe('awaiting');
  });
  test('the three states', () => {
    expect(chatStatus('a', sets(['a'], []))).toBe('working');
    expect(chatStatus('a', sets([], ['a']))).toBe('awaiting');
    expect(chatStatus('a', sets([], []))).toBe('idle');
  });
});

describe('awaitingInputIds', () => {
  test('paused is not enough — something has to be being asked', () => {
    expect([...awaitingInputIds([{ status: 'paused', conversationPlatformId: 'a' }])]).toEqual([]);
    expect([
      ...awaitingInputIds([
        { status: 'paused', approval: { message: 'ok?' }, conversationPlatformId: 'a' },
      ]),
    ]).toEqual(['a']);
  });
  test('a running run never counts, approval or not', () => {
    expect([
      ...awaitingInputIds([
        { status: 'running', approval: { message: 'x' }, conversationPlatformId: 'a' },
      ]),
    ]).toEqual([]);
  });
  test('a chat-dispatched run is found by its worker id — the feed has no other', () => {
    // The dashboard runs feed exposes a web run's conversation as
    // `worker_platform_id`; `conversationPlatformId` is absent there. Reading
    // only the latter is why this never fired.
    expect([
      ...awaitingInputIds([
        { status: 'paused', approval: { message: 'ok?' }, workerPlatformId: 'web-1' },
      ]),
    ]).toEqual(['web-1']);
  });

  test('an explicit conversation id still wins over the worker id', () => {
    expect([
      ...awaitingInputIds([
        {
          status: 'paused',
          approval: { message: 'ok?' },
          conversationPlatformId: 'cli-1',
          workerPlatformId: 'web-1',
        },
      ]),
    ]).toEqual(['cli-1']);
  });

  test('a run with no conversation is skipped rather than crashing', () => {
    expect([
      ...awaitingInputIds([
        { status: 'paused', approval: {}, conversationPlatformId: null },
        { status: 'paused', approval: {} },
      ]),
    ]).toEqual([]);
  });
});

describe('askAwaitingIds', () => {
  const ask = (body: string): string => ['```ask', body, '```'].join('\n');
  const spec = '{"questions":[{"title":"Ship it?","options":[{"label":"Yes"}]}]}';

  test('a chat whose last message is a question is your move', () => {
    expect([
      ...askAwaitingIds([{ id: 'a', askCandidate: `Here is the call:\n${ask(spec)}` }]),
    ]).toEqual(['a']);
  });

  test('no candidate, nothing to decide', () => {
    expect([...askAwaitingIds([{ id: 'a', askCandidate: null }])]).toEqual([]);
  });

  test('the parser decides, not the fence — an unparseable block is prose', () => {
    // The server sends anything containing the fence, deliberately. What counts
    // as a question is settled here.
    expect([...askAwaitingIds([{ id: 'a', askCandidate: ask('{ not json') }])]).toEqual([]);
  });

  test('an ask block shown as an EXAMPLE inside a longer fence is not a question', () => {
    const quoted = ['````markdown', ask(spec), '````'].join('\n');
    expect([...askAwaitingIds([{ id: 'a', askCandidate: quoted }])]).toEqual([]);
  });
});

describe('chatStatus when the working signal is missing', () => {
  const none: ReadonlySet<string> = new Set();

  // The regression this replaced: a third set marked every chat whose last
  // word was the agent's as awaiting. Every finished chat ends that way, so
  // the rail went five-for-five amber — and because `working` is polled, a
  // chat being actively worked on announced that it needed a human for the
  // seconds after a reconnect.
  test('the agent having spoken last is not a call for help', () => {
    expect(chatStatus('a', { working: none, awaiting: none })).toBe('idle');
  });

  test('an unknown answer falls to silence, never to amber', () => {
    expect(chatStatus('unheard-of', { working: none, awaiting: none })).toBe('idle');
  });

  test('a gate still outranks working', () => {
    expect(chatStatus('a', { working: new Set(['a']), awaiting: new Set(['a']) })).toBe('awaiting');
  });
});

describe('awaitingReplyIds', () => {
  test('a chat the agent spoke in last is waiting on you', () => {
    expect([...awaitingReplyIds([{ id: 'a', lastMessageRole: 'assistant' }])]).toEqual(['a']);
  });

  test('a chat you spoke in last is not — the ball is with the machine', () => {
    expect([...awaitingReplyIds([{ id: 'a', lastMessageRole: 'user' }])]).toEqual([]);
  });

  test('an empty chat, or a server that never sent the field, stays quiet', () => {
    expect([...awaitingReplyIds([{ id: 'a', lastMessageRole: null }])]).toEqual([]);
    expect([...awaitingReplyIds([{ id: 'a', lastMessageRole: 'system' }])]).toEqual([]);
  });
});

describe('chatStatus ranks awaitingReply below working', () => {
  const none: ReadonlySet<string> = new Set();
  const a = new Set(['a']);

  // Mid-turn the agent's own streamed text is the last message, so without
  // this a running chat would go amber the moment it said anything.
  test('working wins over having spoken last', () => {
    expect(chatStatus('a', { working: a, awaiting: none, awaitingReply: a })).toBe('working');
  });

  test('a gate still wins over working', () => {
    expect(chatStatus('a', { working: a, awaiting: a, awaitingReply: a })).toBe('awaiting');
  });

  test('once the turn ends, having spoken last is your move', () => {
    expect(chatStatus('a', { working: none, awaiting: none, awaitingReply: a })).toBe('awaiting');
  });

  // The defect that got this reverted the first time: before the first poll
  // lands, "not working" and "not asked" are the same empty set. Callers
  // withhold the set until the answer is known, and then idle is the honest
  // reading rather than a false call for help.
  test('withheld until the working answer is known, it cannot cry wolf', () => {
    expect(chatStatus('a', { working: none, awaiting: none })).toBe('idle');
  });
});
