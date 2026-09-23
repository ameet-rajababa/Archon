import { mock, describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { createMockQuery, createQueryResult, mockPostgresDialect } from '../test/mocks/database';
// spyOn (NOT mock.module) for config-loader: this file shares a `bun test`
// invocation with the real config-loader.test.ts, and `mock.module` is
// process-global and irreversible — mocking the loader here would poison it.
import * as configLoader from '../config/config-loader';

const mockQuery = createMockQuery();

// Mock the connection module before importing the module under test
mock.module('./connection', () => ({
  pool: {
    query: mockQuery,
  },
  getDialect: () => mockPostgresDialect,
}));

import {
  getOrCreateConversation,
  updateConversation,
  findConversationByPlatformId,
  listConversations,
  nextOrderSlots,
  setConversationCompleted,
  setConversationOrder,
} from './conversations';
import type { Conversation } from '../types';
import { ConversationNotFoundError } from '../types';

describe('conversations', () => {
  beforeEach(() => {
    mockQuery.mockClear();
  });

  describe('getOrCreateConversation', () => {
    const mergedConfig = (assistant: string) =>
      ({ assistant }) as Awaited<ReturnType<typeof configLoader.loadConfig>>;
    let loadConfigSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      loadConfigSpy = spyOn(configLoader, 'loadConfig').mockResolvedValue(mergedConfig('claude'));
    });

    afterEach(() => {
      loadConfigSpy.mockRestore();
    });

    const existingConversation: Conversation = {
      id: 'conv-123',
      platform_type: 'telegram',
      platform_conversation_id: 'chat-456',
      ai_assistant_type: 'claude',
      codebase_id: null,
      cwd: null,
      isolation_env_id: null,
      title: null,
      color: null,
      sort_order: null,
      title_pinned: null,
      completed_at: null,
      hidden: false,
      deleted_at: null,
      user_id: null,
      last_activity_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    test('returns existing conversation when found', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([existingConversation]));

      const result = await getOrCreateConversation('telegram', 'chat-456');

      expect(result).toEqual(existingConversation);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM remote_agent_conversations WHERE platform_type = $1 AND platform_conversation_id = $2',
        ['telegram', 'chat-456']
      );
    });

    test('creates new conversation with default assistant type', async () => {
      const newConversation: Conversation = {
        ...existingConversation,
        id: 'conv-new',
      };

      // First query returns empty (no existing)
      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      // Second query creates new
      mockQuery.mockResolvedValueOnce(createQueryResult([newConversation]));

      const result = await getOrCreateConversation('telegram', 'chat-789');

      expect(result).toEqual(newConversation);
      expect(loadConfigSpy).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        'INSERT INTO remote_agent_conversations (platform_type, platform_conversation_id, ai_assistant_type, codebase_id, cwd, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        ['telegram', 'chat-789', 'claude', null, null, null]
      );
    });

    test('uses codebase assistant type when codebaseId provided', async () => {
      const newConversation: Conversation = {
        ...existingConversation,
        id: 'conv-new',
        ai_assistant_type: 'codex',
        codebase_id: 'codebase-123',
      };

      // First query returns empty (no existing)
      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      // Second query fetches codebase
      mockQuery.mockResolvedValueOnce(createQueryResult([{ ai_assistant_type: 'codex' }]));
      // Third query creates new
      mockQuery.mockResolvedValueOnce(createQueryResult([newConversation]));

      const result = await getOrCreateConversation('telegram', 'chat-789', 'codebase-123');

      expect(result).toEqual(newConversation);
      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        'SELECT ai_assistant_type FROM remote_agent_codebases WHERE id = $1',
        ['codebase-123']
      );
      expect(mockQuery).toHaveBeenNthCalledWith(
        3,
        'INSERT INTO remote_agent_conversations (platform_type, platform_conversation_id, ai_assistant_type, codebase_id, cwd, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        ['telegram', 'chat-789', 'codex', 'codebase-123', null, null]
      );
      // The codebase-level assistant short-circuits the config chain.
      expect(loadConfigSpy).not.toHaveBeenCalled();
    });

    // Harvested from PR #1826 (credit: @EugeneChan00) — the configured default
    // assistant chain (config > DEFAULT_AI_ASSISTANT env > first built-in, all
    // owned by loadConfig) must reach new conversations without a codebase.
    test('resolves the configured default assistant when no codebase is scoped', async () => {
      loadConfigSpy.mockResolvedValueOnce(mergedConfig('codex'));

      const newConversation: Conversation = {
        ...existingConversation,
        id: 'conv-new',
        ai_assistant_type: 'codex',
      };

      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      mockQuery.mockResolvedValueOnce(createQueryResult([newConversation]));

      const result = await getOrCreateConversation('web', 'web-new-chat');

      expect(result).toEqual(newConversation);
      expect(loadConfigSpy).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        'INSERT INTO remote_agent_conversations (platform_type, platform_conversation_id, ai_assistant_type, codebase_id, cwd, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        ['web', 'web-new-chat', 'codex', null, null, null]
      );
    });

    test('falls back to claude when config load fails', async () => {
      loadConfigSpy.mockRejectedValueOnce(new Error('config unavailable'));

      const newConversation: Conversation = {
        ...existingConversation,
        id: 'conv-new',
      };

      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      mockQuery.mockResolvedValueOnce(createQueryResult([newConversation]));

      const result = await getOrCreateConversation('web', 'web-new-chat');

      expect(result).toEqual(newConversation);
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        'INSERT INTO remote_agent_conversations (platform_type, platform_conversation_id, ai_assistant_type, codebase_id, cwd, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        ['web', 'web-new-chat', 'claude', null, null, null]
      );
    });

    test('falls back to configured default when codebase not found', async () => {
      const newConversation: Conversation = {
        ...existingConversation,
        id: 'conv-new',
      };

      // First query returns empty (no existing)
      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      // Second query fetches codebase - not found
      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      // Third query creates new
      mockQuery.mockResolvedValueOnce(createQueryResult([newConversation]));

      const result = await getOrCreateConversation('telegram', 'chat-789', 'non-existent-codebase');

      expect(result).toEqual(newConversation);
      // Missing row → falls through to the config chain.
      expect(loadConfigSpy).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenNthCalledWith(
        3,
        'INSERT INTO remote_agent_conversations (platform_type, platform_conversation_id, ai_assistant_type, codebase_id, cwd, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        ['telegram', 'chat-789', 'claude', 'non-existent-codebase', null, null]
      );
    });

    test('inherits context from parent conversation', async () => {
      const parentConversation: Conversation = {
        ...existingConversation,
        id: 'parent-conv',
        platform_conversation_id: 'parent-channel',
        codebase_id: 'codebase-123',
        cwd: '/workspace/project',
        ai_assistant_type: 'codex',
      };
      const newConversation: Conversation = {
        ...existingConversation,
        id: 'thread-conv',
        platform_conversation_id: 'thread-123',
        codebase_id: 'codebase-123',
        cwd: '/workspace/project',
        ai_assistant_type: 'codex',
      };

      // First query returns empty (no existing thread conversation)
      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      // Second query fetches parent conversation
      mockQuery.mockResolvedValueOnce(createQueryResult([parentConversation]));
      // Third query creates new
      mockQuery.mockResolvedValueOnce(createQueryResult([newConversation]));

      const result = await getOrCreateConversation(
        'discord',
        'thread-123',
        undefined,
        'parent-channel'
      );

      expect(result).toEqual(newConversation);
      expect(mockQuery).toHaveBeenCalledTimes(3);
      // Verify parent lookup
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        'SELECT * FROM remote_agent_conversations WHERE platform_type = $1 AND platform_conversation_id = $2',
        ['discord', 'parent-channel']
      );
      // Verify inherited values in INSERT
      expect(mockQuery).toHaveBeenNthCalledWith(
        3,
        'INSERT INTO remote_agent_conversations (platform_type, platform_conversation_id, ai_assistant_type, codebase_id, cwd, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        ['discord', 'thread-123', 'codex', 'codebase-123', '/workspace/project', null]
      );
      // Parent inheritance short-circuits the config chain.
      expect(loadConfigSpy).not.toHaveBeenCalled();
    });

    test('does not inherit when parent has no context', async () => {
      const parentConversation: Conversation = {
        ...existingConversation,
        id: 'parent-conv',
        platform_conversation_id: 'parent-channel',
        codebase_id: null,
        cwd: null,
      };
      const newConversation: Conversation = {
        ...existingConversation,
        id: 'thread-conv',
        platform_conversation_id: 'thread-123',
      };

      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      mockQuery.mockResolvedValueOnce(createQueryResult([parentConversation]));
      mockQuery.mockResolvedValueOnce(createQueryResult([newConversation]));

      const result = await getOrCreateConversation(
        'discord',
        'thread-123',
        undefined,
        'parent-channel'
      );

      expect(result).toEqual(newConversation);
      // Should use inherited assistant type but null for codebase/cwd
      expect(mockQuery).toHaveBeenNthCalledWith(
        3,
        'INSERT INTO remote_agent_conversations (platform_type, platform_conversation_id, ai_assistant_type, codebase_id, cwd, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        ['discord', 'thread-123', 'claude', null, null, null]
      );
    });
  });

  describe('findConversationByPlatformId', () => {
    const cliConversation: Conversation = {
      id: 'conv-cli-1',
      platform_type: 'cli',
      platform_conversation_id: 'cli-1234-abc',
      ai_assistant_type: 'claude',
      codebase_id: null,
      cwd: null,
      isolation_env_id: null,
      title: null,
      color: null,
      sort_order: null,
      title_pinned: null,
      completed_at: null,
      hidden: false,
      deleted_at: null,
      user_id: null,
      last_activity_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    test('returns conversation when platform_conversation_id matches', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([cliConversation]));

      const result = await findConversationByPlatformId('cli-1234-abc');

      expect(result).toEqual(cliConversation);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM remote_agent_conversations WHERE platform_conversation_id = $1',
        ['cli-1234-abc']
      );
    });

    test('returns null when no conversation matches', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      const result = await findConversationByPlatformId('nonexistent');

      expect(result).toBeNull();
    });

    test('works for any platform type without filtering', async () => {
      const telegramConv: Conversation = {
        ...cliConversation,
        id: 'conv-tg-1',
        platform_type: 'telegram',
        platform_conversation_id: 'tg-chat-999',
      };
      mockQuery.mockResolvedValueOnce(createQueryResult([telegramConv]));

      const result = await findConversationByPlatformId('tg-chat-999');

      expect(result).toEqual(telegramConv);
      // Verify no platform_type in the query
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM remote_agent_conversations WHERE platform_conversation_id = $1',
        ['tg-chat-999']
      );
    });
  });

  describe('updateConversation', () => {
    test('updates codebase_id only', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await updateConversation('conv-123', { codebase_id: 'codebase-456' });

      expect(mockQuery).toHaveBeenCalledWith(
        'UPDATE remote_agent_conversations SET codebase_id = $1, updated_at = NOW() WHERE id = $2',
        ['codebase-456', 'conv-123']
      );
    });

    test('updates cwd only', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await updateConversation('conv-123', { cwd: '/workspace/project' });

      expect(mockQuery).toHaveBeenCalledWith(
        'UPDATE remote_agent_conversations SET cwd = $1, updated_at = NOW() WHERE id = $2',
        ['/workspace/project', 'conv-123']
      );
    });

    test('updates both fields', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await updateConversation('conv-123', {
        codebase_id: 'codebase-456',
        cwd: '/workspace/project',
      });

      expect(mockQuery).toHaveBeenCalledWith(
        'UPDATE remote_agent_conversations SET codebase_id = $1, cwd = $2, updated_at = NOW() WHERE id = $3',
        ['codebase-456', '/workspace/project', 'conv-123']
      );
    });

    test('does nothing when no updates provided', async () => {
      await updateConversation('conv-123', {});

      expect(mockQuery).not.toHaveBeenCalled();
    });

    test('allows setting codebase_id to null', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await updateConversation('conv-123', { codebase_id: null });

      expect(mockQuery).toHaveBeenCalledWith(
        'UPDATE remote_agent_conversations SET codebase_id = $1, updated_at = NOW() WHERE id = $2',
        [null, 'conv-123']
      );
    });

    test('throws ConversationNotFoundError when conversation not found (rowCount === 0)', async () => {
      // Simulate UPDATE returning 0 rows affected
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));

      await expect(
        updateConversation('non-existent-id', { codebase_id: 'codebase-456' })
      ).rejects.toThrow(ConversationNotFoundError);

      // Verify the error contains the conversation ID
      try {
        mockQuery.mockResolvedValueOnce(createQueryResult([], 0));
        await updateConversation('test-conv-id', { cwd: '/workspace' });
      } catch (error) {
        expect(error).toBeInstanceOf(ConversationNotFoundError);
        expect((error as ConversationNotFoundError).conversationId).toBe('test-conv-id');
        expect((error as ConversationNotFoundError).message).toBe(
          'Conversation not found: test-conv-id'
        );
      }
    });
  });

  describe('nextOrderSlots', () => {
    test('reuses exactly the values the run already holds', () => {
      // The whole point: the values in play are unchanged, so no chat that was
      // out of view can be displaced by arranging the ones that were.
      expect(nextOrderSlots([5, 2, 9])).toEqual([2, 5, 9]);
    });

    test('a chat with no value yet extends the range downward', () => {
      // Below the lowest in play, so an unplaced chat can sit above every
      // placed one.
      expect(nextOrderSlots([null, 4, 7])).toEqual([3, 4, 7]);
      expect(nextOrderSlots([null, null, 4])).toEqual([2, 3, 4]);
    });

    test('nothing arranged yet starts somewhere and stays ordered', () => {
      expect(nextOrderSlots([null, null, null])).toEqual([-3, -2, -1]);
    });

    test('position decides who gets which value, not who was null', () => {
      // A brand-new chat dragged to the BOTTOM takes the highest value. If the
      // seed followed the null instead of the position, it would spring back
      // to the top on the next load.
      const slots = nextOrderSlots([1, 6, null]);
      expect(slots).toEqual([0, 1, 6]);
      expect(slots[2]).toBe(6);
    });

    test('an empty run has nothing to assign', () => {
      expect(nextOrderSlots([])).toEqual([]);
    });
  });

  describe('setConversationOrder', () => {
    test('writes only the rows whose position actually changes', async () => {
      // Two chats swap; the third is already where it belongs and must not be
      // written. An ordinary drag touches a handful of rows, not the rail.
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          { id: 'a', sort_order: 1 },
          { id: 'b', sort_order: 2 },
          { id: 'c', sort_order: 3 },
        ])
      );

      await setConversationOrder(['b', 'a', 'c']);

      const updates = mockQuery.mock.calls.filter(call => String(call[0]).startsWith('UPDATE'));
      expect(updates).toHaveLength(2);
      expect(updates.map(call => call[1])).toEqual([
        [1, 'b'],
        [2, 'a'],
      ]);
    });

    test('an id that no longer exists does not consume a position', async () => {
      // A rail that has not refreshed still names a deleted chat. Letting it
      // take a slot would shift every chat below it by one.
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          { id: 'a', sort_order: 1 },
          { id: 'c', sort_order: 3 },
        ])
      );

      await setConversationOrder(['a', 'gone', 'c']);

      const updates = mockQuery.mock.calls.filter(call => String(call[0]).startsWith('UPDATE'));
      expect(updates).toHaveLength(0);
    });

    test('an empty order never touches the database', async () => {
      await setConversationOrder([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('listConversations — lifecycle filter', () => {
    const sqlOf = async (state?: 'open' | 'done' | 'all'): Promise<string> => {
      mockQuery.mockClear();
      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      await listConversations(50, undefined, undefined, false, undefined, 'active', state);
      return String(mockQuery.mock.calls[0]?.[0]);
    };

    test('open and done each ask about completed_at', async () => {
      expect(await sqlOf('open')).toContain('completed_at IS NULL');
      expect(await sqlOf('done')).toContain('completed_at IS NOT NULL');
    });

    test('omitting it asks nothing, so an existing caller keeps its rows', async () => {
      // The console is the only caller that filters. Every other reader —
      // the orchestrator, the adapters — predates the column and must not
      // silently start losing finished chats.
      expect(await sqlOf()).not.toContain('completed_at');
    });

    test('the two filters are separate clauses on separate columns', async () => {
      // `deleted_at` says whether a row was removed; `completed_at` says
      // whether the work landed. Collapsing them into one clause is what made
      // four states out of two questions.
      const sql = await sqlOf('open');
      expect(sql).toContain('deleted_at IS NULL');
      expect(sql).toContain('completed_at IS NULL');
    });
  });

  describe('setConversationCompleted', () => {
    test('marking done writes a timestamp, reopening clears it', async () => {
      // The timestamp IS the state — there is no second boolean that can
      // disagree with it — so reopening has to write NULL rather than a
      // falsy value the readers would still see as a completion.
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      await setConversationCompleted('conv-1', true);
      expect(String(mockQuery.mock.calls[0]?.[0])).toContain('completed_at = NOW()');

      mockQuery.mockClear();
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      await setConversationCompleted('conv-1', false);
      expect(String(mockQuery.mock.calls[0]?.[0])).toContain('completed_at = NULL');
    });

    test('it never touches deleted_at — done and archived are separate', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      await setConversationCompleted('conv-1', true);
      expect(String(mockQuery.mock.calls[0]?.[0])).not.toContain('deleted_at');
    });

    test('a chat that is not there is an error, not a silent no-op', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));
      await expect(setConversationCompleted('gone', true)).rejects.toBeInstanceOf(
        ConversationNotFoundError
      );
    });
  });
});
