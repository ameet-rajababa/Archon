/**
 * What the deploy replacing this server is doing, polled without taking a turn.
 *
 * Rides `lib/live-chats`, which already polls `/api/health` for the rail, rather
 * than adding a timer of its own — the endpoint carrying this answer is the one
 * that read is already making. What matters more than the saved request is what
 * this is NOT: it is a plain HTTP GET from the browser, so it takes no
 * conversation lock. A deploy drains the box before it swaps the container,
 * waiting for every turn already in flight to finish, so asking a chat how the
 * deploy is going is one of the things the deploy waits for. Watching it must
 * not be able to starve it.
 */

import { useEffect, useState } from 'react';
import type { DeployStatus } from '../skills/activeChats';
import { elapsedSince, formatElapsed } from './format';
import { useLiveChats } from './live-chats';

export interface LiveDeploy {
  /**
   * Absent when the server has not answered yet, when its build has no deploy
   * block, and when it could not read the host's deploy files. All three are the
   * same instruction to the caller: say nothing.
   */
  status?: DeployStatus;
}

export function useDeployStatus(): LiveDeploy {
  const { deploy } = useLiveChats();
  return deploy === undefined ? {} : { status: deploy };
}

/**
 * Elapsed time since an attempt started, ticking once a second.
 *
 * The moving number is the point. Step 4 can build for six minutes and step 5
 * can wait for twenty without a single line changing, and a surface that does
 * not move is indistinguishable from one that has died. The poll behind
 * everything else here is every 30 seconds; this costs no requests at all.
 *
 * Lives beside the poll rather than in a component because both surfaces that
 * read this status want the same clock.
 */
export function useDeployElapsed(startedAt: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return (): void => {
      clearInterval(id);
    };
  }, [startedAt]);
  if (startedAt === null) return null;
  return formatElapsed(elapsedSince(startedAt, new Date(now).toISOString()));
}
