import { describe, expect, it } from 'bun:test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trackTempRoots } from '@archon/paths/test-utils';
import { runLiveOwnerPath } from '@archon/core/services/run-live-owner';
import { requestDetachedRunStop } from '@archon/core/services/run-owner-stop';

// These fixtures are torn down after tests that spawn, and then kill, a real detached
// child. A killed process can still hold a handle inside its temp tree at the instant of
// cleanup, and an unretried removal fails a test whose assertions already passed (#2306).
const trackTempRoot = trackTempRoots();

/**
 * How long a spawned fixture process may take to reach the state a test polls for: to
 * signal that it is ready, to exit on its own, or to be gone once the terminator
 * stopped it. Every wait in this spec measures that one quantity, so they share this.
 *
 * Sized from Windows measurement, not from raising it until failures stopped (#53). In
 * CI run 36075980448 — three attempts of a single commit — the cheapest possible
 * process, `bun -e 'process.exit(0)'`, took 352 ms, 770 ms and 5088 ms from spawn to
 * exit. A 14x swing with no code change, so any budget inside that observed range is
 * not a budget. Booting a fixture that imports `@archon/core` and spawns a child of its
 * own costs strictly more than that. 15 s sits clear of the range with room for a
 * slower runner. The same run measured Linux at 82 ms for the whole stop scenario, so
 * the wider window costs nothing where the work is fast; these are polls and events,
 * never sleeps, so nothing waits longer than the thing it waits for.
 */
const FIXTURE_STATE_DEADLINE_MS = 15_000;

/**
 * For a test that spawns a real process. It has to exceed the waits nested inside it, or a
 * test that stalls reports this outer timeout instead of the wait that actually stalled
 * and what it was waiting for. The stop scenario nests three fixture-state waits around
 * a `stop()` whose own Windows path allows 30 s per process listing, so this is a
 * ceiling on a hung test and not a budget anything healthy approaches: the same test
 * measured 5848 ms on Windows and 82 ms on Linux.
 */
const STOP_TEST_TIMEOUT_MS = 120_000;

async function waitFor(what: string, check: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`Timed out after ${String(Date.now() - started)}ms waiting for ${what}`);
    }
    await new Promise<void>(resolve => setTimeout(resolve, 25));
  }
}

/** Wait for a spawned fixture process to reach the state `check` describes. */
async function waitForFixtureProcess(what: string, check: () => boolean): Promise<void> {
  await waitFor(what, check, FIXTURE_STATE_DEADLINE_MS);
}

interface ExitOutcome {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

type ExitEvent = ExitOutcome | { readonly error: Error };

interface ExitWatch {
  /** Resolve with how the child exited, or reject naming `what` and the time waited. */
  exited(what: string): Promise<ExitOutcome>;
}

/**
 * Watch for a spawned child's exit from the moment it is spawned, and wait for that exit
 * separately.
 *
 * Splitting the two is the fix for #53. The listeners have to be attached at spawn, or an
 * exit that happens before anything waits for it is missed — but attaching a deadline
 * there too charged every wait for whatever ran between the spawn and the wait. In the
 * stop scenario that was a fixture boot, a readiness poll and the whole Windows stop
 * path: an 8 s deadline enclosing a 5 s readiness wait and a stop allowed 30 s per
 * process listing. It fired 11 ms and 17 ms past 8 s on a Windows runner whose owner was
 * still shutting down, which is the flake. Here the clock starts when a caller starts
 * waiting, so each wait is bounded by its own subject.
 */
function watchExit(child: ChildProcess): ExitWatch {
  let observed: ExitEvent | undefined;
  const waiting = new Set<(event: ExitEvent) => void>();
  const settle = (event: ExitEvent): void => {
    observed ??= event;
    for (const waiter of [...waiting]) waiter(event);
    waiting.clear();
  };
  child.once('exit', (code, signal) => {
    settle({ code, signal });
  });
  child.once('error', error => {
    settle({ error });
  });

  return {
    exited: (what: string): Promise<ExitOutcome> =>
      new Promise<ExitOutcome>((resolve, reject) => {
        const deliver = (event: ExitEvent): void => {
          if ('error' in event) reject(event.error);
          else resolve(event);
        };
        if (observed) {
          deliver(observed);
          return;
        }
        const started = Date.now();
        const timer = setTimeout(() => {
          waiting.delete(waiter);
          reject(
            new Error(
              `Timed out after ${String(Date.now() - started)}ms waiting for ${what} to exit`
            )
          );
        }, FIXTURE_STATE_DEADLINE_MS);
        const waiter = (event: ExitEvent): void => {
          clearTimeout(timer);
          deliver(event);
        };
        waiting.add(waiter);
      }),
  };
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Reads `ProcessId` and `ParentProcessId` for every process. Encoded rather than passed
// through `-Command` so Windows argument quoting cannot alter it, as the production
// listing in windows-process-tree.ts is.
const PARENTAGE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Get-CimInstance -ClassName Win32_Process | ForEach-Object {',
  '  "$($_.ProcessId) $($_.ParentProcessId)"',
  '}',
].join('\n');
const PARENTAGE_ENCODED = Buffer.from(PARENTAGE_SCRIPT, 'utf16le').toString('base64');

/**
 * Which of `pids` are alive AND still name `parentPid` as their parent.
 *
 * `process.kill(pid, 0)` cannot answer that, and on Windows it is the wrong question. The
 * spawning target below creates a child every 10 ms and the stop kills every one it
 * finds, so this test frees dozens of PIDs while the rest of the Windows leg is spawning
 * thousands of processes of its own. Windows reissues a freed PID quickly, so a bare
 * liveness check reports an unrelated process that reused a dead child's PID as a
 * survivor — which is why the assertion failed only under a full parallel suite and
 * passed every time the file ran alone.
 *
 * This is the same PID-reuse hazard `WindowsProcessTree` pins with creation ticks; an
 * assertion about that code has to pin identity too, or it is not testing the claim. A
 * genuine survivor is still caught: Windows keeps a child's `ParentProcessId` after the
 * parent exits, so a child the kill missed continues to name the spawner.
 */
function aliveChildrenOf(parentPid: number, pids: readonly number[]): number[] {
  const listing = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', PARENTAGE_ENCODED],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }
  );
  const parentOf = new Map<number, number>();
  for (const line of listing.split('\n')) {
    const [pid, parent] = line.trim().split(' ').map(Number);
    if (Number.isInteger(pid) && Number.isInteger(parent)) parentOf.set(pid, parent);
  }
  return pids.filter((pid): boolean => parentOf.get(pid) === parentPid);
}

async function listen(server: Server, path: string): Promise<void> {
  await new Promise<void>((resolve: () => void, reject: (reason?: unknown) => void): void => {
    server.once('error', reject);
    server.listen(path, resolve);
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    server.close((): void => {
      resolve();
    });
  });
}

async function rejectedError(action: () => Promise<unknown>): Promise<Error> {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`Expected an Error rejection, received ${String(error)}`);
  }
  throw new Error('Expected the operation to reject');
}

/**
 * A control endpoint that hands out `pid` and commits the termination lease.
 *
 * The handshake is not what these tests are about: committing it puts the terminator
 * itself in front of a PID the test chose, which is the only way to stage a target
 * that is already gone, or one that is alive and out of reach.
 *
 * `leaseMs` closes the lease that long after committing it, as a real owner does when
 * its termination lease lapses.
 */
function stubOwner(pid: number, leaseMs?: number): Server {
  return createServer((socket: Socket): void => {
    socket.setEncoding('utf8');
    let request = '';
    socket.on('data', (chunk: string): void => {
      request += chunk;
      if (request.includes('stop\n')) {
        socket.write(`${JSON.stringify({ kind: 'detached', pid })}\n`);
        request = request.replace('stop\n', '');
      }
      if (request.includes('terminate\n')) {
        socket.write('ready\n');
        request = request.replace('terminate\n', '');
        if (leaseMs !== undefined) setTimeout(() => socket.destroy(), leaseMs);
      }
    });
  });
}

describe('detached run control integration', () => {
  it(
    'stops the detached owner process group before its descendant can leak work',
    async () => {
      const runId = `tree-${crypto.randomUUID()}`;
      const fixtureDir = trackTempRoot(mkdtempSync(join(tmpdir(), 'archon-detached-control-')));
      const readyPath = join(fixtureDir, 'ready');
      const leakPath = join(fixtureDir, 'leaked');
      const goPath = join(fixtureDir, 'go');
      const fixturePath = join(import.meta.dir, 'fixtures', 'detached-run-owner.ts');
      const owner = spawn(process.execPath, [fixturePath, runId, readyPath, leakPath, goPath], {
        detached: true,
        stdio: 'ignore',
      });
      if (owner.pid === undefined) throw new Error('Failed to spawn detached owner fixture');
      const watch = watchExit(owner);

      try {
        await waitForFixtureProcess('the detached owner fixture to signal ready', () =>
          existsSync(readyPath)
        );
        const pids = JSON.parse(readFileSync(readyPath, 'utf8')) as {
          owner: number;
          leakWriter: number;
        };
        // The descendant is live and armed before the stop: if the coming stop
        // failed to take the process group, it would remain able to act on the
        // go signal, so its death is a meaningful (not vacuous) transition.
        expect(pids.leakWriter).toBeGreaterThan(0);
        expect(processExists(pids.leakWriter)).toBe(true);
        const target = await requestDetachedRunStop(runId);
        await target.stop();
        // The stop resolved, so the terminator has already proved the owner gone. Only
        // the exit event's delivery is left, which is why this wait starts its clock
        // here rather than back at the spawn.
        await watch.exited('the detached owner');
        // Event-driven proof instead of a fixed sleep: wait for the descendant's
        // observable death. A dead process cannot act on any future signal.
        await waitForFixtureProcess(
          `the descendant ${String(pids.leakWriter)} to be gone`,
          () => !processExists(pids.leakWriter)
        );
        writeFileSync(goPath, 'go');
        expect(existsSync(leakPath)).toBe(false);
      } finally {
        if (owner.exitCode === null && owner.signalCode === null) {
          try {
            if (process.platform === 'win32') owner.kill();
            else process.kill(-owner.pid, 'SIGKILL');
          } catch {
            // The primary assertion reports failures; cleanup is best-effort for an already-gone fixture.
          }
        }
        if (process.platform !== 'win32') rmSync(runLiveOwnerPath(runId), { force: true });
      }
    },
    STOP_TEST_TIMEOUT_MS
  );

  it(
    'treats an already-gone target as a stopped tree, not a failed stop',
    async () => {
      // #2946: `taskkill /T` walks the tree PID by PID and exits non-zero when one of
      // them is already gone. Reading that exit code as failure made `archon workflow
      // cancel` report a failure on Windows for a run whose tree had in fact stopped,
      // and left the run row saying `running`. POSIX has always tolerated the same
      // condition as ESRCH; the contract is one tree-is-gone outcome on both branches.
      const runId = `already-gone-${crypto.randomUUID()}`;
      const path = runLiveOwnerPath(runId);
      const doomed = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
      if (doomed.pid === undefined) throw new Error('Failed to spawn the short-lived target');
      const gonePid = doomed.pid;
      await watchExit(doomed).exited('the short-lived target');
      // The premise, asserted rather than assumed: the terminator is aimed at nothing.
      await waitForFixtureProcess(
        `the short-lived target ${String(gonePid)} to be gone`,
        () => !processExists(gonePid)
      );

      const server = stubOwner(gonePid);
      await listen(server, path);
      try {
        const target = await requestDetachedRunStop(runId);
        // Resolving IS the assertion, and letting a rejection through reports the real
        // reason rather than a matcher's. The old Windows branch rejected here, carrying
        // taskkill's "There is no running instance of the task" as a stop failure.
        await target.stop();
      } finally {
        await close(server);
        if (process.platform !== 'win32') rmSync(path, { force: true });
      }
    },
    STOP_TEST_TIMEOUT_MS
  );

  it(
    'does not report a Windows tree stopped while a descendant the first kill missed is alive',
    async () => {
      // #3466: `taskkill /T` kills the tree it saw when it started. A descendant spawned
      // while that walk runs survives it, and the old path then confirmed only the root.
      // The target here spawns a detached child every few milliseconds, so every stop
      // races at least one spawn. On Windows a detached child also breaks away from the
      // runtime's kill-on-close job, so nothing but the stop itself can end it. POSIX is
      // out of scope: a detached child there leaves the process group on purpose.
      if (process.platform !== 'win32') return;

      const runId = `spawner-${crypto.randomUUID()}`;
      const path = runLiveOwnerPath(runId);
      const kidsDir = trackTempRoot(mkdtempSync(join(tmpdir(), 'archon-spawner-')));
      // Each child's PID is recorded twice, by the spawner and by the child itself, as the
      // file's name, so a record can never be read half-written.
      const spawner = spawn(
        process.execPath,
        [
          '-e',
          [
            "const { spawn } = require('node:child_process');",
            "const fs = require('node:fs');",
            "const path = require('node:path');",
            'const dir = process.argv[1];',
            "const kid = \"require('node:fs').writeFileSync(require('node:path').join(process.argv[1], String(process.pid)), ''); setInterval(() => undefined, 1000);\";",
            'const loop = () => {',
            "  const child = spawn(process.execPath, ['-e', kid, dir], { detached: true, stdio: 'ignore' });",
            "  fs.writeFileSync(path.join(dir, String(child.pid)), '');",
            '  setTimeout(loop, 10);',
            '};',
            'loop();',
          ].join('\n'),
          kidsDir,
        ],
        { detached: true, stdio: 'ignore' }
      );
      if (spawner.pid === undefined) throw new Error('Failed to spawn the spawning target');
      const recordedKids = (): number[] => readdirSync(kidsDir).map(Number);

      const server = stubOwner(spawner.pid);
      await listen(server, path);
      try {
        // The target is spawning before the stop begins, so the race is live.
        await waitForFixtureProcess(
          'the spawning target to record three children',
          () => recordedKids().length >= 3
        );
        const target = await requestDetachedRunStop(runId);
        await target.stop();

        // A stop that resolves claims the whole tree is gone. Check that claim against
        // every child the target ever recorded, by parentage rather than by PID alone.
        expect(processExists(spawner.pid)).toBe(false);
        expect(aliveChildrenOf(spawner.pid, recordedKids())).toEqual([]);
      } finally {
        // Only PIDs this test still owns. Most of the recorded children are dead by now
        // and Windows has reissued their PIDs, so killing the recorded list unfiltered
        // killed whatever process had inherited each one — other packages' `git` and
        // `bun` processes, in a leg that runs them by the thousand in parallel. That
        // reached the rest of the suite as unexplained non-zero exits with empty stderr
        // (a killed process reports no error of its own), which is why the Windows leg
        // failed in a different package on almost every run. `spawner.pid` is checked
        // the same way, with the spawn's own handle rather than its bare PID.
        for (const pid of aliveChildrenOf(spawner.pid, recordedKids())) {
          try {
            process.kill(pid);
          } catch {
            // Already gone between the listing and the kill; the assertions above are
            // what report a survivor.
          }
        }
        if (spawner.exitCode === null && spawner.signalCode === null) spawner.kill();
        await close(server);
      }
    },
    STOP_TEST_TIMEOUT_MS
  );

  it(
    'reports an unconfirmed Windows stop, killing nothing, when an exited root left a child',
    async () => {
      // The root is gone before the stop, so nothing pins which process held its PID. A
      // process naming that PID as its parent may be an unrelated earlier holder's child,
      // so the stop must refuse to call the tree gone, and must not kill on the guess.
      if (process.platform !== 'win32') return;

      const runId = `orphaned-${crypto.randomUUID()}`;
      const path = runLiveOwnerPath(runId);
      const fixtureDir = trackTempRoot(mkdtempSync(join(tmpdir(), 'archon-orphaned-')));
      const childPidPath = join(fixtureDir, 'child');
      const root = spawn(
        process.execPath,
        [
          '-e',
          [
            "const { spawn } = require('node:child_process');",
            "const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], { detached: true, stdio: 'ignore' });",
            "require('node:fs').writeFileSync(process.argv[1], String(child.pid));",
            'process.exit(0);',
          ].join('\n'),
          childPidPath,
        ],
        { stdio: 'ignore' }
      );
      if (root.pid === undefined) throw new Error('Failed to spawn the exiting root');
      await watchExit(root).exited('the exiting root');
      const childPid = Number(readFileSync(childPidPath, 'utf8'));
      expect(processExists(childPid)).toBe(true);

      const server = stubOwner(root.pid);
      await listen(server, path);
      try {
        const target = await requestDetachedRunStop(runId);
        const error = await rejectedError(async (): Promise<void> => target.stop());
        expect(error.message).toContain('Could not confirm');
        expect(processExists(childPid)).toBe(true);
      } finally {
        try {
          process.kill(childPid);
        } catch {
          // Already gone: the assertion above reports it.
        }
        await close(server);
      }
    },
    STOP_TEST_TIMEOUT_MS
  );

  it(
    'kills nothing on Windows when the lease lapses before the kill',
    async () => {
      // The first process listing takes hundreds of milliseconds at least. A lease that
      // closes during it no longer proves the listed root is the owner, so the stop must
      // refuse rather than kill whatever now holds that PID.
      if (process.platform !== 'win32') return;

      const runId = `lapsed-${crypto.randomUUID()}`;
      const path = runLiveOwnerPath(runId);
      const target = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], {
        stdio: 'ignore',
      });
      if (target.pid === undefined) throw new Error('Failed to spawn the target');
      const targetPid = target.pid;

      const server = stubOwner(targetPid, 50);
      await listen(server, path);
      try {
        const stop = await requestDetachedRunStop(runId);
        const error = await rejectedError(async (): Promise<void> => stop.stop());
        expect(error.message).toContain('released its termination lease before it was stopped');
        expect(processExists(targetPid)).toBe(true);
      } finally {
        target.kill();
        await close(server);
      }
    },
    STOP_TEST_TIMEOUT_MS
  );

  it(
    'still fails when the target is alive and the kill cannot reach it',
    async () => {
      // The guardrail for the tolerance above: an unreachable kill must never read as a
      // stopped tree, or the terminator stops protecting anything. Staged on POSIX,
      // where a live process that is not a group leader makes `kill(-pid)` raise the
      // same ESRCH that an entirely absent group raises — so only the follow-up check
      // on the process itself can tell the two apart. The Windows equivalent, a live
      // root that survives `taskkill /F`, needs a process the runner is not permitted
      // to kill and is not worth staging in CI.
      if (process.platform === 'win32') return;

      const runId = `alive-${crypto.randomUUID()}`;
      const path = runLiveOwnerPath(runId);
      // Not `detached`, so it joins this spec's process group and no process group
      // carrying its own PID exists for the terminator to signal.
      const survivor = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], {
        stdio: 'ignore',
      });
      if (survivor.pid === undefined) throw new Error('Failed to spawn the surviving target');
      const survivorPid = survivor.pid;

      const server = stubOwner(survivorPid);
      await listen(server, path);
      try {
        const target = await requestDetachedRunStop(runId);
        const error = await rejectedError(async (): Promise<void> => target.stop());
        expect(error.message).toContain('does not own process group');
        expect(processExists(survivorPid)).toBe(true);
      } finally {
        survivor.kill('SIGKILL');
        await close(server);
        rmSync(path, { force: true });
      }
    },
    STOP_TEST_TIMEOUT_MS
  );

  it(
    'refuses a marked POSIX owner that does not own its expected process group',
    async () => {
      if (process.platform === 'win32') return;

      const runId = `foreground-${crypto.randomUUID()}`;
      const fixtureDir = trackTempRoot(mkdtempSync(join(tmpdir(), 'archon-foreground-control-')));
      const readyPath = join(fixtureDir, 'ready');
      const leakPath = join(fixtureDir, 'leaked');
      const goPath = join(fixtureDir, 'go');
      const fixturePath = join(import.meta.dir, 'fixtures', 'detached-run-owner.ts');
      const owner = spawn(process.execPath, [fixturePath, runId, readyPath, leakPath, goPath], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      if (owner.pid === undefined) throw new Error('Failed to spawn foreground owner fixture');
      let stderr = '';
      owner.stderr?.on('data', chunk => {
        stderr += String(chunk);
      });

      const result = await watchExit(owner).exited('the foreground owner fixture');
      expect(result.code).not.toBe(0);
      expect(stderr).toContain('does not own process group');
      expect(existsSync(readyPath)).toBe(false);
    },
    STOP_TEST_TIMEOUT_MS
  );
});
