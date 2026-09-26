import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// `* text=auto` checks this workflow out with CRLF on Windows CI. Normalizing here lets
// every pattern below anchor on LF, so a stray `\r` can never reach a capture.
const workflow = readFileSync(
  resolve(import.meta.dir, '../.github/workflows/test.yml'),
  'utf8'
).replace(/\r\n/g, '\n');

const concurrency = /^concurrency:\n {2}group: (.+)\n {2}cancel-in-progress: (.+)$/m.exec(workflow);

test('Test Suite keys its concurrency group on the commit off pull requests', () => {
  expect(concurrency).not.toBeNull();
  const [, group = '', cancel = ''] = concurrency ?? [];

  // The branch half is the point: a push to main or dev, and a manual dispatch, must land
  // in a group of their own so the next merge cannot cancel the run before it. Without the
  // commit in the group every branch run shares one, and same-commit repeatability — the
  // first acceptance item of #74 — cannot be measured on dev at all.
  expect(group).toContain('github.sha');
  // And the pull-request half must survive: should-run-test-suite.ts depends on an older
  // run of the same PR being superseded, or a docs-only push can cancel a code push's run
  // and then skip the suite, leaving the PR head untested.
  expect(group).toContain('github.ref');
  expect(group).toContain("github.event_name == 'pull_request'");
  expect(cancel.trim()).toBe("${{ github.event_name == 'pull_request' }}");
});
