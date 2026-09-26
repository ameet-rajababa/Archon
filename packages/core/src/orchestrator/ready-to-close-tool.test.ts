import { describe, expect, test } from 'bun:test';
import { buildReadyToCloseTool } from './ready-to-close-tool';

function harness(mark?: (ready: boolean) => Promise<void>): {
  tool: ReturnType<typeof buildReadyToCloseTool>;
  calls: boolean[];
} {
  const calls: boolean[] = [];
  const tool = buildReadyToCloseTool({
    conversationId: 'conv-1',
    mark:
      mark ??
      (async (ready): Promise<void> => {
        calls.push(ready);
      }),
  });
  return { tool, calls };
}

describe('mark_ready_to_close', () => {
  test('a bare call claims the work has landed', async () => {
    const { tool, calls } = harness();
    const out = await tool.handler({});
    expect(calls).toEqual([true]);
    expect(out).toContain('Ready to close');
  });

  test('withdraw takes the claim back', async () => {
    const { tool, calls } = harness();
    await tool.handler({ withdraw: true });
    expect(calls).toEqual([false]);
  });

  test('a non-boolean withdraw is not a withdrawal', async () => {
    // The schema says boolean, but the input crosses a provider boundary as
    // `Record<string, unknown>`. A truthy string must not silently invert the
    // meaning of the call.
    const { tool, calls } = harness();
    await tool.handler({ withdraw: 'false' });
    expect(calls).toEqual([true]);
  });

  test('it returns the failure rather than throwing', async () => {
    // Provider adapters add no safety net — an uncaught throw surfaces into the
    // agent loop.
    const { tool } = harness(() => Promise.reject(new Error('db gone')));
    const out = await tool.handler({});
    expect(out).toContain('db gone');
  });

  test('there is no tool that marks the chat done', () => {
    // The whole reason this is only half a decision: an agent that could write
    // `done` would be closing its own work, and afterwards nothing could tell a
    // finished chat from one that had declared itself finished.
    const { tool } = harness();
    expect(tool.name).toBe('mark_ready_to_close');
    expect(JSON.stringify(tool.inputSchema)).not.toContain('done');
  });
});
