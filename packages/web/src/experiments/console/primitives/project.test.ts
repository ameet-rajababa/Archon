import { describe, expect, test } from 'bun:test';
import { clampDropToGroup, groupByOwner, ownerOf, toProject } from './project';

const base = {
  id: 'p1',
  name: 'rajababa-io/vault',
  default_cwd: '/src',
  repository_url: null,
  updated_at: '2026-09-21T00:00:00Z',
  created_at: '2026-09-01T00:00:00Z',
};

describe('toProject', () => {
  test('reads the brief off the project row', () => {
    const p = toProject({
      ...base,
      presentation: { brief: { why: 'w', doing: 'd', where: 'r', updatedAt: 42 } },
    });
    expect(p.brief).toEqual({ why: 'w', doing: 'd', where: 'r', updatedAt: 42 });
  });

  test('no presentation at all is no brief, not a crash', () => {
    expect(toProject(base).brief).toBeNull();
    expect(toProject({ ...base, presentation: null }).brief).toBeNull();
    expect(toProject({ ...base, presentation: { brief: null } }).brief).toBeNull();
  });

  test('a brief of only whitespace is no brief', () => {
    // Otherwise the card renders an empty bordered box, which reads as "there
    // is nothing to say about this project" rather than "nothing written yet".
    const p = toProject({
      ...base,
      presentation: { brief: { why: '  ', doing: '\n', where: '' } },
    });
    expect(p.brief).toBeNull();
  });

  test('a partial brief keeps the fields it has and blanks the rest', () => {
    const p = toProject({ ...base, presentation: { brief: { doing: 'shipping the rail' } } });
    expect(p.brief).toEqual({ why: '', doing: 'shipping the rail', where: '', updatedAt: null });
  });
});

describe('ownerOf', () => {
  test('is the part before the first slash', () => {
    expect(ownerOf('rajababa-io/vault')).toBe('rajababa-io');
  });
  test('a bare name owns itself — a locally added folder has no org', () => {
    expect(ownerOf('archon')).toBe('archon');
  });
  test('only the FIRST slash splits it', () => {
    expect(ownerOf('acme/group/repo')).toBe('acme');
  });
});

describe('groupByOwner', () => {
  const n = (name: string): { name: string } => ({ name });

  test('groups appear where their first project already sat', () => {
    // The input is a HAND order. Sorting groups alphabetically here would
    // silently rearrange a rail somebody dragged into shape.
    const g = groupByOwner([n('z-org/a'), n('a-org/b'), n('z-org/c')]);
    expect(g.map(x => x.owner)).toEqual(['z-org', 'a-org']);
  });

  test('items keep their order inside a group', () => {
    const g = groupByOwner([n('o/c'), n('o/a'), n('o/b')]);
    expect(g[0].items.map(x => x.name)).toEqual(['o/c', 'o/a', 'o/b']);
  });

  test('an interleaved owner is still made contiguous', () => {
    const g = groupByOwner([n('a/1'), n('b/1'), n('a/2')]);
    expect(g.map(x => ({ o: x.owner, n: x.items.length }))).toEqual([
      { o: 'a', n: 2 },
      { o: 'b', n: 1 },
    ]);
  });

  test('start is the group first item index in the REGROUPED list', () => {
    // Not the input index — the rail renders the regrouped order, and the drag
    // clamp indexes into that.
    const g = groupByOwner([n('a/1'), n('b/1'), n('a/2')]);
    expect(g.map(x => x.start)).toEqual([0, 2]);
  });

  test('an empty list is no groups, not one empty group', () => {
    expect(groupByOwner([])).toEqual([]);
  });
});

describe('clampDropToGroup', () => {
  const p = (id: string, name: string): { id: string; name: string } => ({ id, name });
  // [a/1 a/2] [b/1] [c/1 c/2]  ->  indices 0 1 | 2 | 3 4
  const groups = groupByOwner([
    p('a1', 'a/1'),
    p('a2', 'a/2'),
    p('b1', 'b/1'),
    p('c1', 'c/1'),
    p('c2', 'c/2'),
  ]);

  test('a drop inside the row own group is left alone', () => {
    expect(clampDropToGroup(groups, 'c1', 4)).toBe(4);
    expect(clampDropToGroup(groups, 'a2', 0)).toBe(0);
  });

  test('dragging up past the group top stops at the top of that group', () => {
    // c1 hauled to the very top lands first among c's, NOT among a's.
    expect(clampDropToGroup(groups, 'c1', 0)).toBe(3);
  });

  test('dragging down past the group bottom stops at the bottom of that group', () => {
    expect(clampDropToGroup(groups, 'a1', 4)).toBe(1);
  });

  test('a lone project in its own group cannot move at all', () => {
    expect(clampDropToGroup(groups, 'b1', 0)).toBe(2);
    expect(clampDropToGroup(groups, 'b1', 4)).toBe(2);
  });

  test('an unknown id passes through — the caller decides what to do', () => {
    expect(clampDropToGroup(groups, 'nope', 3)).toBe(3);
  });
});
