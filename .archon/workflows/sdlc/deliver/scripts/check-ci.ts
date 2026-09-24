/**
 * Classify the current branch PR's check state, once.
 *
 * Archon-owned facts only (gh state, never the project's toolchain). This is the
 * single-shot probe inside the `await-checks` loop_group: the engine's durable
 * `wait:` node owns the time between probes and a concluded check signals it, so this
 * script never sleeps through CI — it reads the state, declares it, and exits.
 *
 * States, declared through this node's `output_format` so `when:` and `until_bash`
 * branch on a certified field rather than on prose:
 *   pending    checks exist and some are still running
 *   concluded  green, no CI configured, or CI gated on a maintainer's approval (fork
 *              or first contribution) — a gate only a maintainer can open, named,
 *              never blocked on and never called green
 *   red        concluded with non-green checks, named. `pass` counts, `skipping` is
 *              accepted as non-blocking, and everything else — `fail`, `cancel`, or
 *              any bucket this script does not recognize — is red. A cancelled check
 *              is not a green check (R4).
 *
 * Red is a report, never a verdict: this probe declares the state and the deliver
 * tail's convergence pass decides what it means — introduced red is correction work,
 * while inherited or environment red pauses for explicit operator action. Nothing here
 * retries: a concluded check does not re-run itself.
 *
 * The one in-process wait: when CI is configured but nothing has started yet,
 * registration gets a single 60 s grace before the maintainer-gated skip is declared.
 * The durable wait around this probe owns the time BETWEEN probes, which is a
 * different problem from a check that has not registered to signal anything yet.
 */

import { emit, refuse, trimmed } from '../../.shared/io.ts';

/** The recorded pull request, so no read ever falls back to the ambient branch. */
const prUrl = trimmed(process.env.INPUTS_PR_URL);

/**
 * The pull request's own repository, from the identity the `pr` node recorded.
 *
 * Every other read here names the pull request by URL, which is unambiguous. The
 * workflows read below cannot: `gh api`'s `{owner}/{repo}` placeholders resolve from
 * the checkout's remotes, and in a fork-style checkout that is the upstream rather than
 * the repository this run published to. It would answer a question about someone else's
 * repository — so the path is named explicitly, the same way every public step in this
 * tail has since #31.
 */
const repoPath = trimmed(process.env.INPUTS_REPO_PATH);

/**
 * The recorded path before it reaches a command line. A malformed one is a wiring
 * defect in the run rather than a condition the forge is in, so it refuses like an
 * unbound pull request rather than degrading to an answer.
 */
function isOwnerRepo(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}

interface Check {
  readonly name: string;
  readonly bucket: string;
}

interface Ran {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

function gh(...args: string[]): Ran {
  const result = Bun.spawnSync(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function isCheck(value: unknown): value is Check {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === 'string' && typeof record.bucket === 'string';
}

/**
 * Whether this pull request has no checks, asked as a count rather than read as prose.
 *
 * The listing below encodes check state in its exit code rather than read success —
 * it can exit zero on failing checks and non-zero on none — so its status separates
 * neither "this pull request has no checks" from "the read failed", and it says which
 * only in a sentence. The rollup answers that one question as a number: zero on a
 * check-less pull request, a non-zero exit when the read itself failed. A failed
 * observation is never evidence that no CI exists, so anything but a clean zero
 * refuses. `length` reads a null rollup as zero, which is the same answer.
 */
function hasNoChecks(): boolean {
  const counted = gh(
    'pr',
    'view',
    prUrl,
    '--json',
    'statusCheckRollup',
    '--jq',
    '.statusCheckRollup | length'
  );
  return counted.ok && counted.stdout.trim() === '0';
}

/** `undefined` means the read itself failed and nothing may be concluded from it. */
function checks(): readonly Check[] | undefined {
  const result = gh('pr', 'checks', prUrl, '--json', 'name,bucket');
  let parsed: unknown;
  try {
    // The document decides, not the exit status: this form reports failing checks
    // through the buckets it prints, and its status says nothing reliable about
    // whether the read worked. Only stdout that is no JSON document at all goes on to
    // ask the count.
    parsed = JSON.parse(result.stdout) as unknown;
  } catch {
    if (hasNoChecks()) return [];
    refuse(`check-ci: could not read check state: ${result.stderr.trim()}`);
    return undefined;
  }
  if (!Array.isArray(parsed) || !parsed.every(isCheck)) {
    refuse(`check-ci: unexpected check payload shape: ${result.stdout.slice(0, 200)}`);
    return undefined;
  }
  return parsed;
}

/** One workflow, read for the only field this counts on. */
interface WorkflowSummary {
  readonly state: string;
}

function isWorkflowSummary(value: unknown): value is WorkflowSummary {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).state === 'string'
  );
}

/**
 * One page's workflow states, or `undefined` for a page this cannot read. A page whose
 * shape is unrecognized is not evidence that no CI exists, so it fails the whole count
 * rather than contributing zero to it.
 */
function workflowStates(page: unknown): readonly string[] | undefined {
  if (typeof page !== 'object' || page === null) return undefined;
  const workflows = (page as Record<string, unknown>).workflows;
  if (!Array.isArray(workflows) || !workflows.every(isWorkflowSummary)) return undefined;
  return workflows.map(workflow => workflow.state);
}

/**
 * `undefined` means the answer could not be determined, which counts as configured.
 *
 * This asked `gh` to slurp and filter in one call. gh refuses that combination outright
 * — `the --slurp option is not supported with --jq or --template` — so the call exited
 * non-zero on every repository, the function always returned the fail-safe, and the
 * branch it exists for was dead: a repository with no CI at all still paid the 60 s
 * registration grace and then reported a maintainer-gated skip, naming fork approval
 * and path filters that were not the reason.
 *
 * Slurping without a filter keeps it one structured read — every page in one JSON
 * document — and moves the count here, where it is typed and a test can reach it.
 */
function repoHasActiveWorkflows(): boolean | undefined {
  // Every page: the default read stops at thirty workflows, and an active one on a
  // later page would otherwise read as "no CI configured".
  const result = gh('api', `repos/${repoPath}/actions/workflows`, '--paginate', '--slurp');
  if (!result.ok) return undefined;

  let pages: unknown;
  try {
    pages = JSON.parse(result.stdout) as unknown;
  } catch {
    return undefined;
  }
  if (!Array.isArray(pages)) return undefined;

  let active = 0;
  for (const page of pages) {
    const states = workflowStates(page);
    if (states === undefined) return undefined;
    active += states.filter(state => state === 'active').length;
  }
  return active > 0;
}

function classify(rounds: readonly Check[]): void {
  const pending = rounds.filter(check => check.bucket === 'pending');
  if (pending.length > 0) {
    emit({ state: 'pending', detail: `${pending.length} check(s) running` });
    return;
  }

  const passed = rounds.filter(check => check.bucket === 'pass');
  const skipped = rounds.filter(check => check.bucket === 'skipping');
  const notGreen = rounds.filter(
    check => check.bucket !== 'pass' && check.bucket !== 'skipping'
  );

  if (notGreen.length > 0) {
    emit({
      state: 'red',
      detail: notGreen.map(check => `${check.name} (${check.bucket})`).join(', '),
    });
    return;
  }

  const note =
    skipped.length > 0
      ? `; skipped (non-blocking): ${skipped.map(check => check.name).join(', ')}`
      : '';
  emit({ state: 'concluded', detail: `all ${passed.length} required check(s) green${note}` });
}

if (prUrl === '') {
  refuse('check-ci: no pull request was bound; the probe reads the recorded pull request, never the ambient branch.');
} else if (!isOwnerRepo(repoPath)) {
  refuse(
    `check-ci: the recorded repository is not an owner/repo: '${repoPath}'. The probe ` +
      'names the pull request\'s own repository rather than letting gh resolve one from ' +
      "the checkout's remotes."
  );
} else {
  const first = checks();
  if (first !== undefined) {
    if (first.length > 0) {
      classify(first);
    } else if (repoHasActiveWorkflows() === false) {
      emit({
        state: 'concluded',
        detail: 'no checks configured on this repository — nothing to await',
      });
    } else {
      // CI exists (or could not be ruled out) but nothing started. Give registration one
      // grace interval, then skip with the reason: starting gated CI is a maintainer's
      // power, not this run's.
      Bun.sleepSync(60_000);
      const second = checks();
      if (second !== undefined) {
        if (second.length > 0) {
          classify(second);
        } else {
          emit({
            state: 'concluded',
            detail:
              'CI is configured but no checks started on this PR — most likely awaiting ' +
              "a maintainer's approval to run (fork or first contribution), or path filters. " +
              'Skipping the CI gate; running and verifying checks stays with the maintainer.',
          });
        }
      }
    }
  }
}
