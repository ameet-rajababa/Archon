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

import type { DeployStatus } from '../skills/activeChats';
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
