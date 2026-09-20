import { describe, expect, test } from 'bun:test';
import { projectState } from './project-state';

const base = { running: 0, paused: 0, recentStatuses: [] as string[], openIssues: 0, chats: 0 };

describe('projectState', () => {
  test('one status wins, most urgent first', () => {
    expect(projectState({ ...base, running: 1, paused: 2, openIssues: 9 }).status).toBe('Running');
    expect(projectState({ ...base, paused: 1, openIssues: 9 }).status).toBe('Waiting');
    expect(projectState({ ...base, openIssues: 9 }).status).toBe('Idle');
    expect(projectState(base).status).toBe('Clear');
  });

  test('chats are not workload', () => {
    expect(projectState({ ...base, chats: 12 }).status).toBe('Clear');
  });

  describe('health follows the newest run, not a tally', () => {
    test('the last run failed → At risk', () => {
      const s = projectState({ ...base, recentStatuses: ['failed', 'completed', 'completed'] });
      expect(s.health).toBe('At risk');
      expect(s.why).toContain('the last run failed');
    });

    test('a streak → Off track', () => {
      const s = projectState({ ...base, recentStatuses: ['failed', 'failed', 'completed'] });
      expect(s.health).toBe('Off track');
      expect(s.why).toContain('the last 2 runs failed');
    });

    test('A SUCCESS CLEARS IT — the bug that shipped', () => {
      // vault and wix-access: failed, then ran again and succeeded. A
      // count-in-a-window rule called both "At risk" for days afterwards.
      expect(
        projectState({ ...base, recentStatuses: ['completed', 'failed', 'failed'] }).health
      ).toBeNull();
    });

    test('no runs at all is not a health problem', () => {
      expect(projectState(base).health).toBeNull();
    });
  });

  test('"Clear · At risk" cannot happen — Clear means clear', () => {
    // work: last run failed, nothing since, no open issues.
    const s = projectState({ ...base, recentStatuses: ['failed', 'completed', 'completed'] });
    expect(s.health).toBe('At risk');
    expect(s.status).not.toBe('Clear');
    expect(s.status).toBe('Idle');
  });

  test('the tooltip carries the arithmetic', () => {
    expect(
      projectState({
        running: 1,
        paused: 0,
        recentStatuses: ['completed'],
        openIssues: 3,
        chats: 4,
      }).why
    ).toBe('1 run executing · 3 open issues · 4 chats');
    expect(projectState(base).why).toBe('nothing open, nothing running');
  });
});
