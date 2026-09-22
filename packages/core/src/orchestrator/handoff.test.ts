import { describe, expect, test } from 'bun:test';
import {
  findSecrets,
  handoffPath,
  lineageMetadata,
  readLineage,
  renderHandoff,
  type HandoffInput,
} from './handoff';

const base: HandoffInput = {
  topic: 'context-bar',
  repo: 'archon-upstream',
  branch: 'local/deploy',
  worktree: '/home/appuser/archon-upstream',
  tldr: 'Built the context bar.',
  decisions: ['One word, never two'],
  failed: [],
  completed: ['Shipped it'],
  remaining: ['Auto-handoff'],
  issues: [],
  filesModified: ['packages/core/src/orchestrator/handoff.ts'],
  evidenceCommand: 'bun run test',
  evidenceExpectation: '796 passing',
  path: '/home/appuser/handoffs/2026-09-22_context-bar.md',
  generated: '2026-09-22',
};

describe('renderHandoff', () => {
  test('every heading is written, including the empty ones', () => {
    // A dropped heading reads as "nobody asked", and the next session re-walks
    // dead ends this one already ruled out.
    const doc = renderHandoff(base);
    for (const h of [
      '## TLDR',
      '## Locked Decisions',
      '## What We Tried That Failed',
      '## Work Completed',
      '## Remaining Tasks',
      '## Known Issues',
      '## Files Modified',
    ]) {
      expect(doc).toContain(h);
    }
  });

  test('an empty section says None., it does not vanish', () => {
    const doc = renderHandoff(base);
    expect(doc).toContain('## What We Tried That Failed\n\nNone.');
  });

  test('Status is line 1 — a resuming session reads one line and can stop', () => {
    expect(renderHandoff(base).split('\n')[0]).toBe(
      'Status: active | Branch: local/deploy | Generated: 2026-09-22'
    );
  });

  test('the chain line appears only when there is a predecessor', () => {
    expect(renderHandoff(base)).not.toContain('Chain:');
    const chained = renderHandoff({ ...base, chain: { n: 2, previous: '/h/older.md' } });
    expect(chained).toContain('Chain: #2 — previous: /h/older.md');
  });

  test('remaining tasks are checkboxes, so finishing one is recordable', () => {
    expect(renderHandoff(base)).toContain('- [ ] Auto-handoff');
  });

  test('the evidence check names a real command and its expected answer', () => {
    const doc = renderHandoff(base);
    expect(doc).toContain('`bun run test`');
    expect(doc).toContain('796 passing');
  });
});

describe('handoffPath', () => {
  test('the first of the day takes the plain name', () => {
    expect(handoffPath('/h', '2026-09-22', 'topic', () => false)).toBe('/h/2026-09-22_topic.md');
  });

  test('a second handoff the same day never overwrites the first', () => {
    const existing = new Set(['/h/2026-09-22_topic.md']);
    expect(handoffPath('/h', '2026-09-22', 'topic', p => existing.has(p))).toBe(
      '/h/2026-09-22_topic-2.md'
    );
  });

  test('it keeps counting rather than stopping at 2', () => {
    const existing = new Set([
      '/h/2026-09-22_t.md',
      '/h/2026-09-22_t-2.md',
      '/h/2026-09-22_t-3.md',
    ]);
    expect(handoffPath('/h', '2026-09-22', 't', p => existing.has(p))).toBe('/h/2026-09-22_t-4.md');
  });
});

describe('findSecrets', () => {
  test('a token in the prose is found, with its line', () => {
    const doc = 'fine\nrotated ghp_' + 'a'.repeat(24) + '\nalso fine';
    expect(findSecrets(doc)).toEqual([{ line: 2, text: expect.stringContaining('ghp_') }]);
  });

  test('naming a secret is not leaking one', () => {
    // The composition rule is "reference by NAME" — this must not trip on it.
    expect(findSecrets('push with the GH_TOKEN url; rotated B2_APP_KEY')).toEqual([]);
  });

  test('a clean document is clean', () => {
    expect(findSecrets(renderHandoff(base))).toEqual([]);
  });
});

describe('handoff lineage', () => {
  const lineage = { from: 'conv-1-db', document: '/h/2026-09-22_topic.md' };

  test('what the relay writes is what the undo reads', () => {
    expect(readLineage(JSON.stringify(lineageMetadata(lineage)))).toEqual(lineage);
  });

  test('a message carrying other metadata is not a handoff', () => {
    // Every assistant row carries usage metadata; none of them is a lineage.
    expect(readLineage(JSON.stringify({ usage: { contextTokens: 120 } }))).toBeNull();
  });

  test('lineage survives alongside other keys', () => {
    const mixed = JSON.stringify({ ...lineageMetadata(lineage), usage: { contextTokens: 1 } });
    expect(readLineage(mixed)).toEqual(lineage);
  });

  // A half-written record must read as absent. The caller's next move is to
  // archive this chat, and doing that with nothing reopened hides both.
  test.each([
    ['no metadata at all', '{}'],
    ['unparseable', '{ not json'],
    ['empty string', ''],
    ['lineage is not an object', JSON.stringify({ handoff: 'conv-1-db' })],
    ['missing document', JSON.stringify({ handoff: { from: 'conv-1-db' } })],
    ['missing from', JSON.stringify({ handoff: { document: '/h/x.md' } })],
    ['empty from', JSON.stringify({ handoff: { from: '', document: '/h/x.md' } })],
    ['from is not a string', JSON.stringify({ handoff: { from: 7, document: '/h/x.md' } })],
  ])('%s reads as no lineage', (_label, metadata) => {
    expect(readLineage(metadata)).toBeNull();
  });
});
