import { describe, expect, test } from 'bun:test';
import { projectState } from './project-state';

const base = { running: 0, paused: 0, failed: 0, openIssues: 0, chats: 0 };

describe('projectState', () => {
  test('one status wins, most urgent first', () => {
    expect(projectState({ ...base, running: 1, paused: 2, openIssues: 9 }).status).toBe('Running');
    expect(projectState({ ...base, paused: 1, openIssues: 9 }).status).toBe('Waiting');
    expect(projectState({ ...base, openIssues: 9 }).status).toBe('Idle');
    expect(projectState(base).status).toBe('Clear');
  });

  test('chats are not workload', () => {
    // talked about, nothing open — Clear, not Idle
    expect(projectState({ ...base, chats: 12 }).status).toBe('Clear');
  });

  test('health is absent when things are fine, so its presence is the signal', () => {
    expect(projectState(base).health).toBeNull();
    expect(projectState({ ...base, failed: 1 }).health).toBe('At risk');
    // Two of the last ten is a fifth — worth flagging, not "broken".
    expect(projectState({ ...base, failed: 2 }).health).toBe('At risk');
    expect(projectState({ ...base, failed: 3 }).health).toBe('Off track');
  });

  test('the tooltip carries the arithmetic', () => {
    expect(projectState({ running: 1, paused: 0, failed: 2, openIssues: 3, chats: 4 }).why).toBe(
      '1 run executing · 2 runs failed · 3 open issues · 4 chats'
    );
    expect(projectState(base).why).toBe('nothing open, nothing running');
  });

  test('singulars and plurals both read', () => {
    expect(projectState({ ...base, running: 1 }).why).toContain('1 run executing');
    expect(projectState({ ...base, running: 2 }).why).toContain('2 runs executing');
  });
});
