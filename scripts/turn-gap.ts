/**
 * Wait for a moment when nothing is mid-flight, so a deploy can swap the
 * container without destroying work.
 *
 * WHY THIS EXISTS. The app is baked into its image, so shipping a commit means
 * recreating the container — and the container is where the work lives. A chat
 * that is merely open survives that: `assistant_session_id` is persisted per
 * conversation, so its next message resumes the provider session with its
 * context intact. What does NOT survive is a turn already in flight, a message
 * queued behind one, or a workflow run mid-execution, which comes back as a
 * `running` row nobody will ever finish.
 *
 * So the deploy asks the server it is about to replace whether this is a good
 * moment, and waits if it is not.
 *
 * THE LOCK IS THE RIGHT SIGNAL. `concurrency.active` counts conversations
 * holding the conversation lock, which is held for a WHOLE turn rather than
 * per tool call — so the gap between two tools inside one turn never reads as
 * quiet. It already merges in conversations with a running workflow;
 * `runningWorkflows` is still checked separately because a run whose
 * conversation is unknown contributes to that count and to nothing else.
 *
 * WHAT THIS CANNOT DO. A message that arrives between the last check and the
 * container stopping is still lost. Closing that would take a drain mode in
 * the server — a state where it finishes what it holds and accepts nothing
 * new. This narrows the window to about a second; it does not remove it.
 */

/** Exit codes. The deploy distinguishes "still busy" from "could not tell". */
export const TURN_GAP_QUIET = 0;
export const TURN_GAP_TIMED_OUT = 1;
export const TURN_GAP_UNREADABLE = 2;

export interface TurnGapSettings {
  /** Where to ask. The server about to be replaced, not the new one. */
  healthUrl: string;
  /** Give up after this many seconds and deploy nothing. */
  timeoutSeconds: number;
  /** Seconds between polls while busy. */
  intervalSeconds: number;
  /** Seconds between the first quiet reading and the confirming one. */
  confirmSeconds: number;
}

export const TURN_GAP_DEFAULTS: TurnGapSettings = {
  healthUrl: 'http://localhost:3000/api/health',
  timeoutSeconds: 1800,
  intervalSeconds: 5,
  confirmSeconds: 2,
};

/**
 * Read a number that must be there.
 *
 * A missing field is an error rather than a zero. Treating "I could not find
 * the count" as "the count is zero" would report quiet at exactly the moment
 * the reading became untrustworthy, which is the one direction this must never
 * fail in.
 */
function requireCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`health payload has no usable ${field} (got ${JSON.stringify(value)})`);
  }
  return value;
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`health payload has no usable ${field}`);
  }
  return value as Record<string, unknown>;
}

/** The tool names in flight, for a message that says what is holding the deploy up. */
function toolNames(activeTools: unknown): string[] {
  if (typeof activeTools !== 'object' || activeTools === null) return [];
  return Object.values(activeTools as Record<string, unknown>)
    .map(entry => {
      if (typeof entry !== 'object' || entry === null) return null;
      const name = (entry as Record<string, unknown>).name;
      return typeof name === 'string' && name.length > 0 ? name : null;
    })
    .filter((name): name is string => name !== null);
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/**
 * Why the container must not be recreated right now, or null when it may be.
 *
 * Throws when the payload cannot be read. The caller must treat that as "do
 * not deploy" rather than as "quiet".
 */
export function busyReason(payload: unknown): string | null {
  const health = asRecord(payload, 'body');
  const concurrency = asRecord(health.concurrency, 'concurrency');

  const active = requireCount(concurrency.active, 'concurrency.active');
  const queued = requireCount(concurrency.queuedTotal, 'concurrency.queuedTotal');
  const workflows = requireCount(health.runningWorkflows, 'runningWorkflows');

  const reasons: string[] = [];
  if (active > 0) {
    const tools = toolNames(concurrency.activeTools);
    const detail = tools.length > 0 ? ` (${tools.join(', ')})` : '';
    reasons.push(`${plural(active, 'chat', 'chats')} mid-turn${detail}`);
  }
  if (queued > 0) reasons.push(`${plural(queued, 'message', 'messages')} queued`);
  if (workflows > 0)
    reasons.push(`${plural(workflows, 'workflow run', 'workflow runs')} executing`);

  return reasons.length === 0 ? null : reasons.join(', ');
}

/** Read settings from the environment, so the deploy script can tune them without arguments. */
export function settingsFromEnv(env: Record<string, string | undefined>): TurnGapSettings {
  const seconds = (key: string, fallback: number): number => {
    const raw = env[key];
    if (raw === undefined || raw.trim() === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(
        `${key} must be a non-negative number of seconds, got ${JSON.stringify(raw)}`
      );
    }
    return parsed;
  };
  const url = env.HEALTH_URL;
  return {
    healthUrl: url !== undefined && url.trim() !== '' ? url : TURN_GAP_DEFAULTS.healthUrl,
    timeoutSeconds: seconds('TURN_GAP_TIMEOUT', TURN_GAP_DEFAULTS.timeoutSeconds),
    intervalSeconds: seconds('TURN_GAP_INTERVAL', TURN_GAP_DEFAULTS.intervalSeconds),
    confirmSeconds: seconds('TURN_GAP_CONFIRM', TURN_GAP_DEFAULTS.confirmSeconds),
  };
}

const sleep = (seconds: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, seconds * 1000));

async function readReason(healthUrl: string): Promise<string | null> {
  const response = await fetch(healthUrl);
  if (!response.ok) throw new Error(`health returned ${String(response.status)}`);
  return busyReason(await response.json());
}

export async function waitForTurnGap(
  settings: TurnGapSettings,
  log: (line: string) => void
): Promise<number> {
  const deadline = Date.now() + settings.timeoutSeconds * 1000;
  let lastReported = '';

  for (;;) {
    let reason: string | null;
    try {
      reason = await readReason(settings.healthUrl);
    } catch (error: unknown) {
      // Unreadable is not quiet. Stopping here leaves the box running what it
      // was running, which is the safe end of this decision.
      log(`cannot tell whether it is safe to swap: ${(error as Error).message}`);
      return TURN_GAP_UNREADABLE;
    }

    if (reason === null) {
      // A second reading, a moment later. The first can land in the instant
      // between a turn ending and the next beginning.
      await sleep(settings.confirmSeconds);
      let confirmation: string | null;
      try {
        confirmation = await readReason(settings.healthUrl);
      } catch (error: unknown) {
        log(`cannot tell whether it is safe to swap: ${(error as Error).message}`);
        return TURN_GAP_UNREADABLE;
      }
      if (confirmation === null) {
        log('quiet — nothing is mid-flight');
        return TURN_GAP_QUIET;
      }
      reason = confirmation;
    }

    if (Date.now() >= deadline) {
      log(`still busy after ${String(settings.timeoutSeconds)}s: ${reason}`);
      return TURN_GAP_TIMED_OUT;
    }

    // Only on change, plus whatever the interval gives. Thirty minutes of
    // "still busy" every five seconds buries the line that matters.
    if (reason !== lastReported) {
      log(`waiting: ${reason}`);
      lastReported = reason;
    }
    await sleep(settings.intervalSeconds);
  }
}

if (import.meta.main) {
  const settings = settingsFromEnv(process.env);
  process.exit(
    await waitForTurnGap(settings, line => {
      console.log(line);
    })
  );
}
