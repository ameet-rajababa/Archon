import { describe, expect, it } from 'bun:test';
import { groupMessages } from './message-groups';
import type { Message, MessageRole } from './message';

let n = 0;
const msg = (role: MessageRole, timestamp: string, category: string | null = null): Message => ({
  id: `m${String(++n)}`,
  role,
  content: 'x',
  timestamp,
  toolCalls: [],
  error: null,
  category,
  dispatch: null,
  workflowResult: null,
  files: [],
  usage: null,
});

describe('groupMessages', () => {
  it('returns nothing for an empty transcript', () => {
    expect(groupMessages([])).toEqual([]);
  });

  it('joins consecutive messages from the same sender', () => {
    const groups = groupMessages([
      msg('assistant', '2026-09-22T18:38:49Z'),
      msg('assistant', '2026-09-22T18:38:49Z'),
      msg('assistant', '2026-09-22T18:38:49Z'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.messages).toHaveLength(3);
  });

  it('splits when the sender changes', () => {
    const groups = groupMessages([
      msg('user', '2026-09-22T18:38:02Z'),
      msg('assistant', '2026-09-22T18:38:15Z'),
      msg('user', '2026-09-22T18:40:00Z'),
    ]);
    expect(groups.map(g => g.role)).toEqual(['user', 'assistant', 'user']);
  });

  // The case that started this: the screenshot had three agent messages
  // sharing 6:38:49, each repeating the label and the time. They collapse —
  // and 6:38:15, a different second, keeps its own honest header.
  it('collapses the messages that share a second, and only those', () => {
    const groups = groupMessages([
      msg('user', '2026-09-22T18:38:02Z'),
      msg('assistant', '2026-09-22T18:38:15Z'),
      msg('assistant', '2026-09-22T18:38:49Z'),
      msg('assistant', '2026-09-22T18:38:49Z'),
      msg('assistant', '2026-09-22T18:38:49Z'),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.map(g => g.messages.length)).toEqual([1, 1, 3]);
  });

  it('takes the timestamp of the message that opened the group', () => {
    const groups = groupMessages([
      msg('assistant', '2026-09-22T18:38:49.100Z'),
      msg('assistant', '2026-09-22T18:38:49.900Z'),
    ]);
    expect(groups[0]?.timestamp).toBe('2026-09-22T18:38:49.100Z');
  });

  it('keys a group by its first message id, not by position', () => {
    const first = msg('assistant', '2026-09-22T18:38:15Z');
    const groups = groupMessages([first, msg('assistant', '2026-09-22T18:38:15Z')]);
    expect(groups[0]?.key).toBe(first.id);
  });

  describe('a header must be true of everything under it', () => {
    it('splits when the displayed second changes', () => {
      const groups = groupMessages([
        msg('assistant', '2026-09-22T18:38:15Z'),
        msg('assistant', '2026-09-22T18:38:16Z'),
      ]);
      expect(groups).toHaveLength(2);
    });

    it('joins messages differing only below the second', () => {
      const groups = groupMessages([
        msg('assistant', '2026-09-22T18:38:49.100Z'),
        msg('assistant', '2026-09-22T18:38:49.900Z'),
      ]);
      expect(groups).toHaveLength(1);
    });

    it('is a split, not a threshold — an hour and a second behave alike', () => {
      const oneSecond = groupMessages([
        msg('assistant', '2026-09-22T18:38:15Z'),
        msg('assistant', '2026-09-22T18:38:16Z'),
      ]);
      const oneHour = groupMessages([
        msg('assistant', '2026-09-22T18:38:15Z'),
        msg('assistant', '2026-09-22T19:38:15Z'),
      ]);
      expect(oneSecond).toHaveLength(2);
      expect(oneHour).toHaveLength(2);
    });

    it('groups by exact string when a timestamp will not parse', () => {
      const same = groupMessages([msg('assistant', 'not-a-date'), msg('assistant', 'not-a-date')]);
      const differ = groupMessages([msg('assistant', 'not-a-date'), msg('assistant', 'nor-this')]);
      expect(same).toHaveLength(1);
      expect(differ).toHaveLength(2);
    });
  });

  describe('messages that render as their own card', () => {
    it('gives a workflow result its own group', () => {
      const groups = groupMessages([
        msg('assistant', '2026-09-22T18:38:15Z'),
        msg('assistant', '2026-09-22T18:38:20Z', 'workflow_result'),
        msg('assistant', '2026-09-22T18:38:25Z'),
      ]);
      expect(groups).toHaveLength(3);
      expect(groups[1]?.messages[0]?.category).toBe('workflow_result');
    });

    it('does not let two cards share a group', () => {
      const groups = groupMessages([
        msg('assistant', '2026-09-22T18:38:20Z', 'workflow_result'),
        msg('assistant', '2026-09-22T18:38:25Z', 'workflow_result'),
      ]);
      expect(groups).toHaveLength(2);
    });
  });

  it('preserves order and loses no message', () => {
    const input = [
      msg('user', '2026-09-22T18:00:00Z'),
      msg('assistant', '2026-09-22T18:00:01Z'),
      msg('assistant', '2026-09-22T18:00:01Z'),
      msg('system', '2026-09-22T18:00:03Z'),
      msg('assistant', '2026-09-22T18:00:04Z'),
    ];
    const flat = groupMessages(input).flatMap(g => g.messages);
    expect(flat.map(m => m.id)).toEqual(input.map(m => m.id));
  });
});
