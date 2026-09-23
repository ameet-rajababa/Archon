/**
 * Tests for `scripts/deploy-on-request.sh` — the host-side half of the deploy.
 *
 * What is under test is the script's REPORTING, not its deploying. This is the
 * only thing that says afterwards what happened, and on 2026-09-23 it said the
 * wrong thing twice in one run: it declared "the box is running whatever it was
 * before" when the swap had in fact happened, and it truncated the failing
 * attempt's log as soon as the next request arrived, so the reason was gone
 * before anyone read it.
 *
 * Driven as a SUBPROCESS with `docker` and the deploy itself stubbed on PATH.
 * The contract is what ends up in the log, the rotated log, and the history
 * file — none of which needs a real container to observe.
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

const trackTempRoot = trackTempRoots();

const SCRIPT = join(import.meta.dir, 'deploy-on-request.sh');
const WANT = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

interface Sandbox {
  volume: string;
  bin: string;
  deploy: string;
  deployDir: string;
}

/**
 * A stub `docker` that answers the two questions the script asks, keyed by the
 * command text rather than by argument position — the real invocation buries it
 * behind `compose exec -T -u root <service> sh -lc`.
 */
function writeDockerStub(bin: string, headSha: string, runningSha: string): void {
  const stub = join(bin, 'docker');
  writeFileSync(
    stub,
    `#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in
    *"rev-parse HEAD"*) printf '%s\\n' '${headSha}'; exit 0 ;;
    *".deployed-sha"*) ${runningSha === '' ? 'exit 1' : `printf '%s\\n' '${runningSha}'; exit 0`} ;;
  esac
done
exit 0
`,
    { mode: 0o755 }
  );
  chmodSync(stub, 0o755);
}

/** A stand-in deploy that prints what deploy-local.sh's `die` would, then fails. */
function writeFailingDeploy(path: string, reason: string): void {
  writeFileSync(path, `#!/usr/bin/env bash\nprintf 'STOPPED: %s\\n' '${reason}' >&2\nexit 1\n`, {
    mode: 0o755,
  });
  chmodSync(path, 0o755);
}

/** A stand-in deploy that hangs, so the script can be signalled mid-flight. */
function writeHangingDeploy(path: string): void {
  writeFileSync(path, '#!/usr/bin/env bash\necho started\nsleep 30\n', { mode: 0o755 });
  chmodSync(path, 0o755);
}

function writeSucceedingDeploy(path: string): void {
  writeFileSync(path, '#!/usr/bin/env bash\necho did the thing\nexit 0\n', { mode: 0o755 });
  chmodSync(path, 0o755);
}

function sandbox(name: string): Sandbox {
  const root = trackTempRoot(mkdtempSync(join(tmpdir(), `deploy-on-request-${name}-`)));
  const volume = join(root, 'volume');
  const bin = join(root, 'bin');
  const deployDir = join(root, 'deploy-dir');
  mkdirSync(volume, { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(deployDir, { recursive: true });
  return { volume, bin, deploy: join(root, 'deploy.sh'), deployDir };
}

function spawnRun(box: Sandbox, request: string): Bun.Subprocess {
  writeFileSync(join(box.volume, 'deploy-request'), `${request}\n`);
  return Bun.spawn(['bash', SCRIPT], {
    env: {
      ...process.env,
      PATH: `${box.bin}:${process.env.PATH ?? ''}`,
      VOLUME: box.volume,
      DEPLOY: box.deploy,
      DEPLOY_DIR: box.deployDir,
      SOURCE_DIR: '/source',
      SERVICE: 'app',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

async function run(box: Sandbox, request: string): Promise<number> {
  return spawnRun(box, request).exited;
}

/** Wait for a line the script writes, so the signal lands mid-deploy. */
async function waitForLog(box: Sandbox, needle: string): Promise<void> {
  const log = join(box.volume, 'deploy-last.log');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(log) && readFileSync(log, 'utf8').includes(needle)) return;
    await Bun.sleep(50);
  }
  throw new Error(`log never mentioned ${needle}`);
}

const read = (path: string): string => readFileSync(path, 'utf8');

describe('a failure that swapped the container anyway', () => {
  test('says the swap happened rather than claiming nothing changed', async () => {
    const box = sandbox('swapped');
    writeDockerStub(box.bin, WANT, WANT);
    writeFailingDeploy(box.deploy, 'swapped, but it never became healthy');

    expect(await run(box, WANT)).toBe(1);

    const log = read(join(box.volume, 'deploy-last.log'));
    expect(log).toContain('the swap DID happen');
    expect(log).toContain(WANT);
    expect(log).not.toContain('running whatever it was before');
  });

  test('records the failing reason in history, not just an exit code', async () => {
    const box = sandbox('reason');
    writeDockerStub(box.bin, WANT, WANT);
    writeFailingDeploy(box.deploy, 'swapped, but it never became healthy');

    await run(box, WANT);

    const history = read(join(box.volume, 'deploy-history'));
    expect(history).toContain('never became healthy');
    expect(history).toContain(`running ${WANT}`);
  });

  test('reports the older commit when the swap did NOT happen', async () => {
    const box = sandbox('not-swapped');
    writeDockerStub(box.bin, WANT, OTHER);
    writeFailingDeploy(box.deploy, 'the box never went quiet');

    await run(box, WANT);

    expect(read(join(box.volume, 'deploy-last.log'))).toContain(`the box is running ${OTHER}`);
  });

  test('an unreadable container is said to be unreadable, never assumed', async () => {
    const box = sandbox('unreadable');
    writeDockerStub(box.bin, WANT, '');
    writeFailingDeploy(box.deploy, 'build failed');

    await run(box, WANT);

    const log = read(join(box.volume, 'deploy-last.log'));
    expect(log).toContain('cannot say what it is running');
    expect(read(join(box.volume, 'deploy-history'))).toContain('running unknown');
  });
});

describe('the losing attempt survives the next request', () => {
  test('the previous log is kept beside the current one', async () => {
    const box = sandbox('rotate');
    writeDockerStub(box.bin, WANT, WANT);
    writeFailingDeploy(box.deploy, 'first attempt died here');
    await run(box, WANT);

    writeSucceedingDeploy(box.deploy);
    await run(box, WANT);

    expect(read(join(box.volume, 'deploy-last.log'))).toContain('DEPLOYED');
    expect(read(join(box.volume, 'deploy-prev.log'))).toContain('first attempt died here');
  });
});

describe('a deploy that is stopped rather than finished', () => {
  test('being killed mid-flight still records what the box is running', async () => {
    const box = sandbox('killed');
    writeDockerStub(box.bin, WANT, WANT);
    writeHangingDeploy(box.deploy);

    const proc = spawnRun(box, WANT);
    await waitForLog(box, 'starting deploy');
    proc.kill('SIGTERM');
    await proc.exited;

    const log = read(join(box.volume, 'deploy-last.log'));
    expect(log).toContain('STOPPED MID-FLIGHT');
    expect(read(join(box.volume, 'deploy-history'))).toContain(`KILLED ${WANT}`);
  });

  test('the recorded verdict names the commit actually live, not the one asked for', async () => {
    const box = sandbox('killed-before-swap');
    writeDockerStub(box.bin, WANT, OTHER);
    writeHangingDeploy(box.deploy);

    const proc = spawnRun(box, WANT);
    await waitForLog(box, 'starting deploy');
    proc.kill('SIGTERM');
    await proc.exited;

    expect(read(join(box.volume, 'deploy-history'))).toContain(`running ${OTHER}`);
  });
});

describe('a checkout that moved is still refused', () => {
  test('deploying the difference is worse than deploying nothing', async () => {
    const box = sandbox('moved');
    writeDockerStub(box.bin, OTHER, OTHER);
    writeSucceedingDeploy(box.deploy);

    expect(await run(box, WANT)).toBe(1);

    const log = read(join(box.volume, 'deploy-last.log'));
    expect(log).toContain(`asked for ${WANT}`);
    expect(log).toContain(`checkout is at ${OTHER}`);
  });
});
