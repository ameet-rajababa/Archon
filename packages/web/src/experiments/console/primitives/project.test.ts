import { describe, expect, test } from 'bun:test';
import { toProject } from './project';

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
