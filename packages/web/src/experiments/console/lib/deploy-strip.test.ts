import { describe, expect, test } from 'bun:test';
import { parseDeploy, type DeployStatus } from '../skills/activeChats';
import { deployStripView, shortSha } from './deploy-strip';

const SHA = '92b597234d5505fc98e71f2a7fd0aa3ea153f7fe';

function status(overrides: Partial<DeployStatus>): DeployStatus {
  return { phase: 'idle', ...overrides };
}

describe('shortSha', () => {
  test('shortens a commit', () => {
    expect(shortSha(SHA)).toBe('92b59723');
  });

  test('leaves the placeholders the deploy history can hold alone', () => {
    // `record()` writes these when it could not read the request. Truncating
    // them to eight characters would invent a SHA out of a placeholder.
    expect(shortSha('<empty>')).toBe('<empty>');
    expect(shortSha('?')).toBe('?');
  });
});

describe('deployStripView', () => {
  test('names the step while building, and shows the elapsed clock', () => {
    const view = deployStripView(
      status({
        phase: 'building',
        sha: SHA,
        startedAt: '2026-09-25T12:17:45Z',
        step: { number: 4, of: 7, name: 'Build' },
      })
    );
    expect(view).toEqual({
      tone: 'live',
      label: 'Building',
      detail: '4/7 Build',
      startedAt: '2026-09-25T12:17:45Z',
      sha: '92b59723',
      verdictAt: null,
    });
  });

  test("says what a drain is holding, in the deploy log's own words", () => {
    // Not a rephrasing: one of those chats may be the reader's, and "1 chat
    // mid-turn" is what tells them to stop typing.
    const view = deployStripView(
      status({ phase: 'draining', startedAt: '2026-09-25T12:17:45Z', holding: '1 chat mid-turn' })
    );
    expect(view.label).toBe('Draining');
    expect(view.detail).toBe('waiting for 1 chat mid-turn');
    expect(view.tone).toBe('live');
  });

  test('says a drain is waiting without claiming what for, when it has not said', () => {
    const view = deployStripView(status({ phase: 'draining', startedAt: '2026-09-25T12:17:45Z' }));
    expect(view.detail).toBe('waiting for the box to finish what it holds');
  });

  test.each([
    ['requested', 'Deploy requested'],
    ['swapping', 'Swapping'],
    ['verifying', 'Verifying'],
  ] as const)('reads %s as %s', (phase, label) => {
    expect(deployStripView(status({ phase, startedAt: '2026-09-25T12:17:45Z' })).label).toBe(label);
  });

  test('says a deploy is running without naming a phase it cannot prove', () => {
    const view = deployStripView(status({ phase: 'unknown', startedAt: '2026-09-25T12:17:45Z' }));
    expect(view.label).toBe('Deploying');
    expect(view.detail).toBe('phase unknown');
    expect(view.tone).toBe('live');
  });

  test('is healthy when nothing is in flight and the last verdict was OK', () => {
    const view = deployStripView(
      status({
        phase: 'idle',
        sha: SHA,
        last: { at: '2026-09-25T11:45:06Z', verdict: 'OK', sha: SHA },
      })
    );
    expect(view).toEqual({
      tone: 'ok',
      label: 'Healthy',
      detail: null,
      startedAt: null,
      sha: '92b59723',
      verdictAt: '2026-09-25T11:45:06Z',
    });
  });

  test.each([
    ['FAILED', 'Deploy failed'],
    ['KILLED', 'Deploy stopped'],
    ['REFUSED', 'Deploy refused'],
  ] as const)('reads a last verdict of %s as %s, and reads badly', (verdict, label) => {
    // The failure mode this exists to prevent: an idle box whose last deploy
    // failed must not read as healthy, or as merely quiet.
    const view = deployStripView(
      status({
        phase: 'idle',
        last: {
          at: '2026-09-25T06:40:35Z',
          verdict,
          sha: SHA,
          reason: 'exit 1 — the box never went quiet',
        },
      })
    );
    expect(view.label).toBe(label);
    expect(view.tone).toBe('bad');
    expect(view.detail).toBe('exit 1 — the box never went quiet');
  });

  test('says there are no deploys when the history is empty', () => {
    // A fresh install has never deployed. Not an error, and not a failure.
    const view = deployStripView(status({ phase: 'idle' }));
    expect(view).toEqual({
      tone: 'quiet',
      label: 'No deploys',
      detail: null,
      startedAt: null,
      sha: null,
      verdictAt: null,
    });
  });
});

describe('parseDeploy', () => {
  test('reads a whole deploy block', () => {
    expect(
      parseDeploy({
        phase: 'draining',
        sha: SHA,
        startedAt: '2026-09-25T12:17:45Z',
        step: { number: 5, of: 7, name: 'Wait for the box to hold nothing' },
        holding: '1 chat mid-turn',
        last: { at: '2026-09-25T11:45:06Z', verdict: 'OK', sha: SHA },
      })
    ).toEqual({
      phase: 'draining',
      sha: SHA,
      startedAt: '2026-09-25T12:17:45Z',
      step: { number: 5, of: 7, name: 'Wait for the box to hold nothing' },
      holding: '1 chat mid-turn',
      last: { at: '2026-09-25T11:45:06Z', verdict: 'OK', sha: SHA },
    });
  });

  test.each([undefined, null, 'idle', 42, {}, { phase: 'shipping' }, { phase: 7 }])(
    'reads nothing from %p',
    raw => {
      // A phase from a newer server is one this build cannot describe, so it is
      // dropped and the strip stays silent rather than rendering a word it does
      // not have a meaning for.
      expect(parseDeploy(raw)).toBeUndefined();
    }
  );

  test('drops a malformed step and verdict rather than the whole block', () => {
    const parsed = parseDeploy({
      phase: 'building',
      step: { number: '4', of: 7, name: 'Build' },
      last: { at: '2026-09-25T11:45:06Z', verdict: 'MAYBE', sha: SHA },
    });
    expect(parsed).toEqual({ phase: 'building' });
  });
});
