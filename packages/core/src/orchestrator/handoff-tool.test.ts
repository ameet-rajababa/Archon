import { describe, expect, mock, test } from 'bun:test';
import { buildUndoHandoffTool } from './handoff-tool';
import type { HandoffLineage } from './handoff';

const LINEAGE: HandoffLineage = { from: 'predecessor-db', document: '/h/2026-09-22_topic.md' };

function arrange(overrides: {
  lineage?: HandoffLineage | null;
  reopen?: (id: string) => Promise<void>;
  markSelfDone?: () => Promise<void>;
}) {
  const calls: string[] = [];
  const reopen =
    overrides.reopen ??
    ((id: string): Promise<void> => {
      calls.push(`reopen:${id}`);
      return Promise.resolve();
    });
  const markSelfDone =
    overrides.markSelfDone ??
    ((): Promise<void> => {
      calls.push('markSelfDone');
      return Promise.resolve();
    });
  const tool = buildUndoHandoffTool({
    lineage: () => Promise.resolve(overrides.lineage ?? null),
    reopen: mock(reopen),
    markSelfDone: mock(markSelfDone),
  });
  return { tool, calls };
}

describe('undo_handoff', () => {
  test('reopens the predecessor and marks this chat done', async () => {
    const { tool, calls } = arrange({ lineage: LINEAGE });

    const result = await tool.handler({});

    // Order is the assertion, not just the pair: reopening first means a
    // failure after it leaves one chat in the open list, never neither.
    expect(calls).toEqual(['reopen:predecessor-db', 'markSelfDone']);
    expect(result).toContain('Undone');
    expect(result).toContain(LINEAGE.document);
  });

  test('a chat nobody handed off says so and changes nothing', async () => {
    const { tool, calls } = arrange({ lineage: null });

    const result = await tool.handler({});

    expect(calls).toEqual([]);
    expect(result).toContain('not opened by a handoff');
  });

  test('the work is described as kept, and named where to find it', async () => {
    const { tool } = arrange({ lineage: LINEAGE });

    // The user is told what survives and which filter holds it. An undo that
    // reads as destructive gets avoided, and an unused undo is the same as no
    // undo at all.
    expect(await tool.handler({})).toContain('Done filter');
  });

  test('a chat that cannot mark itself done still reopened the predecessor', async () => {
    const { tool, calls } = arrange({
      lineage: LINEAGE,
      markSelfDone: () => Promise.reject(new Error('db down')),
    });

    const result = await tool.handler({});

    expect(calls).toEqual(['reopen:predecessor-db']);
    expect(result).toContain('could not be marked done');
    expect(result).toContain('by hand');
  });

  test('a predecessor that cannot be reopened does not close this chat too', async () => {
    const { tool, calls } = arrange({
      lineage: LINEAGE,
      reopen: () => Promise.reject(new Error('db down')),
    });

    // Fails loudly rather than swallowing: finishing on top of a failed
    // reopen is the one outcome that takes both chats out of the open list.
    await expect(tool.handler({})).rejects.toThrow('db down');
    expect(calls).toEqual([]);
  });
});
