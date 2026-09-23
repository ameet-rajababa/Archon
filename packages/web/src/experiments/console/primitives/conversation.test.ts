import { describe, test, expect } from 'bun:test';
import {
  toConversationSummary,
  resolveConversationDbId,
  type ConversationSummary,
} from './conversation';

function summary(over: Partial<ConversationSummary> & { id: string; dbId: string }) {
  return {
    title: null,
    platformType: 'web',
    lastActivityAt: null,
    ...over,
  } satisfies ConversationSummary;
}

describe('toConversationSummary', () => {
  test('keeps the platform id and the DB uuid apart', () => {
    const summarized = toConversationSummary({
      id: '0f4c9f2e-3b41-4d0a-9a11-0b4c2e7d1a55',
      platform_conversation_id: 'web-1750000000-abc',
      platform_type: 'web',
      title: 'Ship the console',
      last_activity_at: '2026-06-05T10:00:00Z',
    });

    expect(summarized.id).toBe('web-1750000000-abc');
    expect(summarized.dbId).toBe('0f4c9f2e-3b41-4d0a-9a11-0b4c2e7d1a55');
  });
});

describe('resolveConversationDbId', () => {
  const conversations = [
    summary({ id: 'web-1750000000-abc', dbId: 'db-uuid-abc' }),
    summary({ id: 'web-1750000001-def', dbId: 'db-uuid-def' }),
  ];

  test('matches on the platform id and returns the DB uuid, not the platform id', () => {
    expect(resolveConversationDbId(conversations, 'web-1750000001-def')).toBe('db-uuid-def');
  });

  test('does not match a DB uuid against the platform id', () => {
    expect(resolveConversationDbId(conversations, 'db-uuid-def')).toBeNull();
  });

  test('is null for an unknown chat, an empty list, and no active chat', () => {
    expect(resolveConversationDbId(conversations, 'web-nope')).toBeNull();
    expect(resolveConversationDbId([], 'web-1750000000-abc')).toBeNull();
    expect(resolveConversationDbId(conversations, null)).toBeNull();
  });
});
