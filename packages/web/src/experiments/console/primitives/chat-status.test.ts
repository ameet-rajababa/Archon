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
  test('a run with no conversation is skipped rather than crashing', () => {
    expect([
      ...awaitingInputIds([
        { status: 'paused', approval: {}, conversationPlatformId: null },
        { status: 'paused', approval: {} },
      ]),
    ]).toEqual([]);
  });
});
