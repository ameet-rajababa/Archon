import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import type { Run } from '../primitives/run';
import { invalidate, set } from '../store/cache';
import { K } from '../store/keys';
import { ChatRunsPanel } from './ChatRunsPanel';

const CHAT_DB_ID = 'chat-conv-db-id';

const baseRun: Omit<Run, 'id' | 'status' | 'workflow'> = {
  projectId: 'project-1',
  projectName: 'Archon',
  costUsd: null,
  conversationId: 'worker-conv-db-id',
  parentConversationId: CHAT_DB_ID,
  conversationPlatformId: null,
  workerPlatformId: null,
  origin: 'web',
  outcome: null,
  startedAt: '2026-09-01T10:00:00.000Z',
  finishedAt: null,
  lastActivityAt: null,
  workingPath: null,
  userMessage: 'Take issue 24 through to a PR',
  activeNodes: [],
  currentNode: null,
  lastTool: null,
};

function render(runs: Run[]): string {
  const cacheKey = K.chatRuns(CHAT_DB_ID);
  set(cacheKey, {
    runs,
    counts: {
      all: runs.length,
      running: 0,
      paused: 0,
      failed: 0,
      completed: 0,
      cancelled: 0,
      pending: 0,
    },
    total: runs.length,
  });
  try {
    return renderToStaticMarkup(
      <MemoryRouter>
        <ChatRunsPanel conversationDbId={CHAT_DB_ID} projectId="project-1" />
      </MemoryRouter>
    );
  } finally {
    invalidate(cacheKey);
  }
}

describe('ChatRunsPanel', () => {
  test('lists in-progress and finished runs alike, each linking to its run detail', () => {
    const html = render([
      { ...baseRun, id: 'run-live', workflow: 'implement', status: 'running' },
      {
        ...baseRun,
        id: 'run-done',
        workflow: 'review',
        status: 'completed',
        finishedAt: '2026-09-01T10:30:00.000Z',
      },
    ]);

    expect(html).toContain('From this chat');
    expect(html).toContain('Running');
    expect(html).toContain('Completed');
    expect(html).toContain('/console/p/project-1/r/run-live');
    expect(html).toContain('/console/p/project-1/r/run-done');
  });

  test('a chat that has launched nothing gets a quiet empty state, not an error', () => {
    const html = render([]);

    expect(html).toContain('No runs started from this chat yet');
    expect(html).not.toContain('text-error');
  });

  test('truncates past five rows behind a "Show all" affordance', () => {
    const runs = Array.from({ length: 7 }, (_, i) => ({
      ...baseRun,
      id: `run-${i.toString()}`,
      workflow: 'implement',
      status: 'completed' as const,
    }));

    const html = render(runs);

    expect(html).toContain('/console/p/project-1/r/run-4');
    expect(html).not.toContain('/console/p/project-1/r/run-5');
    expect(html).toContain('Show all 7');
  });
});
