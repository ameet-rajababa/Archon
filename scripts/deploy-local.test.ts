/**
 * Tests for step 5 of `scripts/deploy-local.sh` — the step that gets the box to a
 * moment when it is holding nothing.
 *
 * WHY AS A SUBPROCESS. What is under test is shell control flow: which of the two
 * paths runs, what the `trap` does on the way out, and which words a failure
 * gets. None of that exists in any function that could be imported, and the
 * riskiest part of it — cancelling drain on every exit path — is precisely the
 * part a unit test of a helper would not cover. So the real script runs, with
 * `docker`, `git` and `curl` stubbed on PATH.
 *
 * The stubs are dumb on purpose, with one exception: the budget clamp is answered
 * by really running `scripts/drain-wait.ts --budget`, so the number the deploy
 * sends is the number that script computes from the endpoint's own maximum.
 *
 * THE INVARIANT WORTH MOST. A deploy that arms drain and dies without cancelling
 * leaves the box refusing all new work until the budget lapses — up to an hour.
 * Every failing case here asserts the DELETE went out.
 */
import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trackTempRoots } from '@archon/paths/test-utils';
import { DEPLOY_STEP_COUNT } from '../packages/server/src/services/deploy-status';

/**
 * POSIX only. These tests drive real shell scripts — they spawn `bash`, write
 * executable stubs onto PATH with a `#!/usr/bin/env bash` shebang, and rely on
 * `chmod` actually granting execute. Windows has none of that, and neither does
 * the thing under test: `deploy-local.sh` and `deploy-on-request.sh` run as root
 * on the Linux host that owns the Docker daemon, and can never run anywhere else.
 *
 * Skipped rather than ported, because a Windows-compatible version of these would
 * be exercising a deployment that does not exist. The suites became visible to the
 * Windows CI job when the deploy scripts reached `dev`; before that they lived only
 * on `local/deploy`, which no Windows runner builds.
 */
const describePosix = process.platform === 'win32' ? describe.skip : describe;

/**
 * POSIX only. These tests drive real shell scripts — they spawn `bash`, write
 * executable stubs onto PATH with a `#!/usr/bin/env bash` shebang, and rely on
 * `chmod` actually granting execute. Windows has none of that, and neither does
 * the thing under test: `deploy-local.sh` and `deploy-on-request.sh` run as root
 * on the Linux host that owns the Docker daemon, and can never run anywhere else.
 *
 * Skipped rather than ported, because a Windows-compatible version of these would
 * be exercising a deployment that does not exist. The suites became visible to the
 * Windows CI job when the deploy scripts reached `dev`; before that they lived only
 * on `local/deploy`, which no Windows runner builds.
 */
const describePosix = process.platform === 'win32' ? describe.skip : describe;

const trackTempRoot = trackTempRoots();

const REPO_ROOT = join(import.meta.dir, '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'deploy-local.sh');
const SHA = 'a'.repeat(40);
/** A token that exists nowhere else, so "did this leak" is a substring search. */
const TOKEN = 'drain-token-sentinel-6f2a';

interface Sandbox {
  root: string;
  bin: string;
  deployDir: string;
  envFile: string;
  curlLog: string;
  curlStdin: string;
  turnGapMarker: string;
}

function write(path: string, body: string): void {
  writeFileSync(path, body, { mode: 0o755 });
  chmodSync(path, 0o755);
}

/**
 * Answers every question the deploy puts to the container, keyed by the command
 * text rather than by argument position — the real invocation buries it behind
 * `compose exec -T -u root <service> sh -lc`. Ordered: the budget query is a
 * `drain-wait.ts` call too, so it has to be recognised first.
 */
function writeDockerStub(box: Sandbox): void {
  write(
    join(box.bin, 'docker'),
    `#!/usr/bin/env bash
all="$*"
case "$all" in
  *"drain-wait.ts --budget"*)
    budget="\${all##*--budget }"
    budget="\${budget%%[!0-9]*}"
    exec bun "${join(REPO_ROOT, 'scripts', 'drain-wait.ts')}" --budget "$budget" ;;
  *"drain-wait.ts"*) exit "\${DRAIN_WAIT_EXIT:-0}" ;;
  *"turn-gap.ts"*) printf 'called\\n' >>'${box.turnGapMarker}'; exit "\${TURN_GAP_EXIT:-0}" ;;
  *"status --porcelain"*) printf '0\\n' ;;
  *"rev-parse HEAD"*) printf '%s\\n' '${SHA}' ;;
  *"ls-remote"*) printf '%s\\n' '${SHA}' ;;
  *".deployed-sha"*) printf '%s\\n' '${SHA}' ;;
  *"compose up -d"*) exit "\${UP_EXIT:-0}" ;;
esac
exit 0
`
  );
}

/** The host-side git: only ever asked for a HEAD, and to pull. */
function writeGitStub(box: Sandbox): void {
  write(
    join(box.bin, 'git'),
    `#!/usr/bin/env bash
case "$*" in
  *"rev-parse HEAD"*) printf '%s\\n' '${SHA}' ;;
esac
exit 0
`
  );
}

/**
 * Records every drain call — method, body, and the full argv — and separately the
 * stdin it was handed. Two assertions ride on that split: the token must appear in
 * the stdin config and never in argv.
 */
function writeCurlStub(box: Sandbox): void {
  write(
    join(box.bin, 'curl'),
    `#!/usr/bin/env bash
all="$*"
case "$all" in
  *"/internal/drain"*)
    method=POST; body=''; prev=''
    for arg in "$@"; do
      case "$prev" in
        -X) method="$arg" ;;
        --data) body="$arg" ;;
      esac
      prev="$arg"
    done
    printf '%s\\t%s\\t%s\\n' "$method" "$body" "$all" >>'${box.curlLog}'
    cat >>'${box.curlStdin}'
    case "$method" in
      POST) printf '%s' "\${DRAIN_POST_CODE:-200}" ;;
      *) printf '%s' "\${DRAIN_DELETE_CODE:-200}" ;;
    esac
    exit 0 ;;
  *"/api/health"*) exit "\${HEALTH_EXIT:-0}" ;;
esac
exit 0
`
  );
}

function sandbox(name: string, envBody: string | null): Sandbox {
  const root = trackTempRoot(mkdtempSync(join(tmpdir(), `deploy-local-${name}-`)));
  const box: Sandbox = {
    root,
    bin: join(root, 'bin'),
    deployDir: join(root, 'deploy-dir'),
    envFile: join(root, '.env'),
    curlLog: join(root, 'curl.log'),
    curlStdin: join(root, 'curl.stdin'),
    turnGapMarker: join(root, 'turn-gap.called'),
  };
  mkdirSync(box.bin, { recursive: true });
  mkdirSync(box.deployDir, { recursive: true });
  writeDockerStub(box);
  writeGitStub(box);
  writeCurlStub(box);
  if (envBody !== null) writeFileSync(box.envFile, envBody);
  return box;
}

interface Result {
  code: number;
  output: string;
  /** One entry per drain call: `[method, body]`. */
  drainCalls: [string, string][];
  argv: string;
  stdin: string;
  turnGapCalled: boolean;
}

async function run(box: Sandbox, env: Record<string, string> = {}): Promise<Result> {
  const proc = Bun.spawn(['bash', SCRIPT], {
    env: {
      ...process.env,
      PATH: `${box.bin}:${process.env.PATH ?? ''}`,
      // Emptied rather than deleted: this suite runs inside a container that has a
      // real token in its environment, and inheriting it would make the
      // no-token case silently test the drain path instead.
      ARCHON_DRAIN_TOKEN: '',
      DEPLOY_DIR: box.deployDir,
      DRAIN_ENV_FILE: box.envFile,
      SOURCE_DIR: '/source',
      SERVICE: 'app',
      // A fixed wait, so the budget the deploy sends does not depend on how long
      // the stubs took.
      TURN_GAP_TIMEOUT: '30',
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const logged = existsSync(box.curlLog) ? readFileSync(box.curlLog, 'utf8') : '';
  return {
    code,
    output: `${stdout}\n${stderr}`,
    drainCalls: logged
      .split('\n')
      .filter(line => line !== '')
      .map(line => {
        const [method, body] = line.split('\t');
        return [method ?? '', body ?? ''];
      }),
    argv: logged,
    stdin: existsSync(box.curlStdin) ? readFileSync(box.curlStdin, 'utf8') : '',
    turnGapCalled: existsSync(box.turnGapMarker),
  };
}

const methods = (result: Result): string[] => result.drainCalls.map(([method]) => method);

describePosix('an install with no drain token', () => {
  test('keeps waiting for a turn-gap, exactly as it did before drain existed', async () => {
    const result = await run(sandbox('no-token', 'SOMETHING_ELSE=1\n'));

    expect(result.code).toBe(0);
    expect(result.turnGapCalled).toBe(true);
    expect(result.drainCalls).toEqual([]);
    expect(result.output).toContain('no drain token configured');
  });

  test('a missing env file is not an error either', async () => {
    const result = await run(sandbox('no-env-file', null));

    expect(result.code).toBe(0);
    expect(result.turnGapCalled).toBe(true);
    expect(result.drainCalls).toEqual([]);
  });

  test('the turn-gap timeout keeps its own words when the box never goes quiet', async () => {
    const result = await run(sandbox('no-token-busy', null), { TURN_GAP_EXIT: '1' });

    expect(result.code).toBe(1);
    expect(result.output).toContain('the box never went quiet');
    expect(result.drainCalls).toEqual([]);
  });
});

describePosix('an install with a drain token', () => {
  test('arms drain, waits, swaps, and never falls back to polling', async () => {
    const result = await run(sandbox('armed', `ARCHON_DRAIN_TOKEN=${TOKEN}\n`));

    expect(result.code).toBe(0);
    expect(result.turnGapCalled).toBe(false);
    // No DELETE: the swap happened, so the process that was draining is gone.
    expect(methods(result)).toEqual(['POST']);
    expect(result.output).toContain('drain armed for');
    expect(result.output).toContain('Deployed');
  });

  test('the budget covers the wait AND the reserve the swap needs', async () => {
    // Held after the wait ends, the server would start accepting work again in
    // the seconds between step 5 succeeding and the container stopping.
    const result = await run(sandbox('budget', `ARCHON_DRAIN_TOKEN=${TOKEN}\n`), {
      SWAP_RESERVE_SECONDS: '120',
      TURN_GAP_TIMEOUT: '300',
    });

    expect(result.drainCalls).toEqual([['POST', '{"budgetSeconds":420}']]);
  });

  test('a budget above the endpoint maximum is clamped, not refused', async () => {
    // The real drain-wait.ts answers this, and it imports the maximum from the
    // route that enforces it — so this is the clamp, not a copy of the number.
    const result = await run(sandbox('clamp', `ARCHON_DRAIN_TOKEN=${TOKEN}\n`), {
      DEPLOY_BUDGET_SECONDS: '100000',
      TURN_GAP_TIMEOUT: '99000',
      SWAP_RESERVE_SECONDS: '1000',
    });

    expect(result.drainCalls).toEqual([['POST', '{"budgetSeconds":3600}']]);
    expect(result.code).toBe(0);
  });

  test('a quoted value in the env file is read as the token, quotes and all removed', async () => {
    const result = await run(sandbox('quoted', `ARCHON_DRAIN_TOKEN="${TOKEN}"\n`));

    expect(methods(result)).toEqual(['POST']);
    // The quotes in the recorded line are the curl config file's own; what must
    // not survive is a token still wrapped in the ones the env file had.
    expect(result.stdin.trim()).toBe(`header = "Authorization: Bearer ${TOKEN}"`);
  });

  test('the token reaches curl on stdin and never through argv', async () => {
    // argv is world-readable in /proc, on a box several unprivileged sessions
    // share.
    const result = await run(sandbox('argv', `ARCHON_DRAIN_TOKEN=${TOKEN}\n`));

    expect(result.stdin).toContain(`Bearer ${TOKEN}`);
    expect(result.argv).not.toContain(TOKEN);
  });

  test('the token never reaches the deploy log', async () => {
    // This script's output is kept as /.archon/deploy-last.log, which several
    // sessions read.
    const result = await run(sandbox('no-leak', `ARCHON_DRAIN_TOKEN=${TOKEN}\n`), {
      DRAIN_WAIT_EXIT: '1',
    });

    expect(result.code).toBe(1);
    expect(result.output).not.toContain(TOKEN);
  });
});

describePosix('drain is cancelled on every path that does not swap', () => {
  const withToken = (name: string): Sandbox => sandbox(name, `ARCHON_DRAIN_TOKEN=${TOKEN}\n`);

  test('a box that never finishes what it holds is its own message', async () => {
    const result = await run(withToken('never-drained'), { DRAIN_WAIT_EXIT: '1' });

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      'drain was armed but the box never finished what it was holding'
    );
    expect(methods(result)).toEqual(['POST', 'DELETE']);
    expect(result.output).toContain('drain cancelled');
  });

  test('an unreadable drain gets different words from a box that is merely busy', async () => {
    const result = await run(withToken('unreadable'), { DRAIN_WAIT_EXIT: '2' });

    expect(result.code).toBe(1);
    expect(result.output).toContain('could not read what the drain is holding');
    expect(result.output).not.toContain('never finished what it was holding');
    expect(methods(result)).toEqual(['POST', 'DELETE']);
  });

  test('a drain that lapsed underneath the deploy is neither of those', async () => {
    const result = await run(withToken('lapsed'), { DRAIN_WAIT_EXIT: '3' });

    expect(result.code).toBe(1);
    expect(result.output).toContain('the drain stopped being in effect while the deploy waited');
    expect(methods(result)).toEqual(['POST', 'DELETE']);
  });

  test('a rejected token stops the deploy and still cancels blind', async () => {
    // Nothing is armed on a 401, but the cancel goes out anyway: the flag is set
    // before the call, so a request whose answer was lost is still cancelled.
    const result = await run(withToken('rejected'), { DRAIN_POST_CODE: '401' });

    expect(result.code).toBe(1);
    expect(result.output).toContain('rejected the token');
    expect(methods(result)).toEqual(['POST', 'DELETE']);
  });

  test('a server with no drain endpoint says so instead of guessing', async () => {
    const result = await run(withToken('no-endpoint'), { DRAIN_POST_CODE: '404' });

    expect(result.code).toBe(1);
    expect(result.output).toContain('there is no drain endpoint');
    expect(methods(result)).toEqual(['POST', 'DELETE']);
  });

  test('a swap that fails to start cancels, because the old container is still serving', async () => {
    const result = await run(withToken('up-failed'), { UP_EXIT: '1' });

    expect(result.code).toBe(1);
    expect(result.output).toContain('up failed');
    expect(methods(result)).toEqual(['POST', 'DELETE']);
  });

  test('a failure AFTER the swap leaves the new server alone', async () => {
    // The health wait and step 7 both run past `up -d`. By then the process that
    // was draining no longer exists, so there is nothing to cancel.
    const result = await run(withToken('post-swap'), { HEALTH_EXIT: '1', HEALTH_WAIT: '0' });

    expect(result.code).toBe(1);
    expect(result.output).toContain('never became healthy');
    expect(methods(result)).toEqual(['POST']);
  });

  test('being killed mid-wait cancels rather than leaving the box refusing work', async () => {
    // The SIGTERM deploy-on-request.sh sends when systemd's deadline expires.
    //
    // The wait is held in a BACKGROUND child precisely so this works: bash defers
    // a trap until the foreground command returns, and the first version of this
    // step held the waiter in the foreground — a signal arriving mid-wait was
    // deferred for the rest of the wait, which is how a box gets left refusing
    // every new message until the drain budget lapses. The `sleep 30` stub here
    // is that half hour; the assertion is that the cancel does not wait for it.
    const box = withToken('signalled');
    write(
      join(box.bin, 'docker'),
      `#!/usr/bin/env bash
case "$*" in
  *"drain-wait.ts --budget"*) printf '450\\n' ;;
  *"drain-wait.ts"*) printf 'waiting\\n' >>'${box.turnGapMarker}'; sleep 30 ;;
  *"status --porcelain"*) printf '0\\n' ;;
  *"rev-parse HEAD"*|*"ls-remote"*|*".deployed-sha"*) printf '%s\\n' '${SHA}' ;;
esac
exit 0
`
    );
    const proc = Bun.spawn(['bash', SCRIPT], {
      env: {
        ...process.env,
        PATH: `${box.bin}:${process.env.PATH ?? ''}`,
        ARCHON_DRAIN_TOKEN: '',
        DEPLOY_DIR: box.deployDir,
        DRAIN_ENV_FILE: box.envFile,
        SOURCE_DIR: '/source',
        SERVICE: 'app',
        TURN_GAP_TIMEOUT: '30',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    for (let attempt = 0; attempt < 200 && !existsSync(box.turnGapMarker); attempt += 1) {
      await Bun.sleep(25);
    }
    expect(existsSync(box.turnGapMarker)).toBe(true);
    proc.kill('SIGTERM');
    await proc.exited;

    expect(await proc.exited).toBe(143);
    const logged = readFileSync(box.curlLog, 'utf8');
    expect(logged).toContain('POST');
    expect(logged).toContain('DELETE');
  }, 20_000);
});

describePosix('SKIP_TURN_GAP keeps meaning what it means', () => {
  test('it swaps immediately and does not quietly become a drain', async () => {
    // Drain finishes the work; this discards it. Conflating them would hand an
    // operator who asked to lose work a deploy that waited instead, and vice versa.
    const result = await run(sandbox('skip', `ARCHON_DRAIN_TOKEN=${TOKEN}\n`), {
      SKIP_TURN_GAP: '1',
    });

    expect(result.code).toBe(0);
    expect(result.drainCalls).toEqual([]);
    expect(result.turnGapCalled).toBe(false);
    expect(result.output).toContain('work in flight WILL be lost');
  });
});

describePosix('a health url the drain endpoint cannot be derived from', () => {
  test('is refused rather than guessed at', async () => {
    const result = await run(sandbox('odd-url', `ARCHON_DRAIN_TOKEN=${TOKEN}\n`), {
      HEALTH_URL: 'http://localhost:3000/healthz',
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain('set DRAIN_URL');
    expect(result.drainCalls).toEqual([]);
  });
});

/**
 * The step markers are a contract, not decoration.
 *
 * `packages/server/src/services/deploy-status.ts` reads them out of
 * `deploy-last.log` to tell the console which phase a deploy is in, and it maps
 * the NUMBERS — 1-4 building, 5 draining, 6 swapping, 7 verifying. Two
 * declarations that must agree, kept in agreement by nobody, is the defect this
 * closes: a renumbered step here would silently relabel the console's strip. The
 * reader answers `unknown` rather than guessing when the layout is not the one it
 * knows, and this is what tells whoever changed the script that it has happened.
 */
describe('the step markers the deploy status reader depends on', () => {
  const script = readFileSync(SCRIPT, 'utf8');
  const steps = [...script.matchAll(/^step "(\d+)\/(\d+) {2}/gmu)];

  test(`has exactly ${String(DEPLOY_STEP_COUNT)} steps, numbered 1 upwards`, () => {
    expect(steps.map(match => match[1])).toEqual(
      Array.from({ length: DEPLOY_STEP_COUNT }, (_, index) => String(index + 1))
    );
  });

  test('says the same total in every marker as the reader expects', () => {
    expect(new Set(steps.map(match => match[2]))).toEqual(new Set([String(DEPLOY_STEP_COUNT)]));
  });
});
