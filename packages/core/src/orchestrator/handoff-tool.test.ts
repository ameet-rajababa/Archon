import { describe, expect, mock, test } from 'bun:test';
import { buildUndoHandoffTool } from './handoff-tool';
import type { HandoffLineage } from './handoff';

const LINEAGE: HandoffLineage = { from: 'predecessor-db', document: '/h/2026-09-22_topic.md' };

function arrange(overrides: {
  lineage?: HandoffLineage | null;
  restore?: (id: string) => Promise<void>;
  archiveSelf?: () => Promise<void>;
}) {
  const calls: string[] = [];
  const restore =
    overrides.restore ??
    ((id: string): Promise<void> => {
      calls.push(`restore:${id}`);
      return Promise.resolve();
    });
  const archiveSelf =
    overrides.archiveSelf ??
    ((): Promise<void> => {
      calls.push('archiveSelf');
      return Promise.resolve();
    });
  const tool = buildUndoHandoffTool({
    lineage: () => Promise.resolve(overrides.lineage ?? null),
    restore: mock(restore),
    archiveSelf: mock(archiveSelf),
  });
  return { tool, calls };
}

describe('undo_handoff', () => {
  test('reopens the predecessor and archives this chat', async () => {
    const { tool, calls } = arrange({ lineage: LINEAGE });

    const result = await tool.handler({});

    // Order is the assertion, not just the pair: reopening first means a
    // failure after it leaves one chat visible, never both hidden.
    expect(calls).toEqual(['restore:predecessor-db', 'archiveSelf']);
    expect(result).toContain('Undone');
    expect(result).toContain(LINEAGE.document);
  });

  test('a chat nobody handed off says so and changes nothing', async () => {
    const { tool, calls } = arrange({ lineage: null });

    const result = await tool.handler({});

    expect(calls).toEqual([]);
    expect(result).toContain('not opened by a handoff');
  });

  test('the work is described as kept, because archiving is a soft delete', async () => {
    const { tool } = arrange({ lineage: LINEAGE });

    // The user is told what survives. An undo that reads as destructive gets
    // avoided, and an unused undo is the same as no undo at all.
    expect(await tool.handler({})).toContain('Archived filter');
  });

  test('a chat that cannot archive itself still reopened the predecessor', async () => {
    const { tool, calls } = arrange({
      lineage: LINEAGE,
      archiveSelf: () => Promise.reject(new Error('db down')),
    });

    const result = await tool.handler({});

    expect(calls).toEqual(['restore:predecessor-db']);
    expect(result).toContain('could not be archived');
    expect(result).toContain('by hand');
  });

  test('a predecessor that cannot be reopened does not archive this chat too', async () => {
    const { tool, calls } = arrange({
      lineage: LINEAGE,
      restore: () => Promise.reject(new Error('db down')),
    });

    // Fails loudly rather than swallowing: archiving on top of a failed
    // restore is the one outcome that hides both chats at once.
    await expect(tool.handler({})).rejects.toThrow('db down');
    expect(calls).toEqual([]);
  });
});
