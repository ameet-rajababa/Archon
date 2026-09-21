import { describe, expect, test } from 'bun:test';
import { awaitingInputIds, chatStatus } from './chat-status';

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
