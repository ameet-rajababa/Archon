import { describe, expect, it } from 'bun:test';
import { projectLabel } from './display-name';

describe('projectLabel', () => {
  it('drops the owner, which the group header and the path already say', () => {
    expect(projectLabel('ameet-rajababa/claude-skills', 'ameet-rajababa/claude-skills')).toBe(
      'claude-skills'
    );
  });

  it('leaves a name with no owner alone', () => {
    expect(projectLabel('archon', 'archon')).toBe('archon');
  });

  it('shows a rename verbatim, slash and all', () => {
    expect(projectLabel('ameet-rajababa/claude-skills', 'skills/v2')).toBe('skills/v2');
  });
});
