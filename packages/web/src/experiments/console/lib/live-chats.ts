/**
 * Which chats the server is executing a turn for, right now.
 *
 * The poll is a backstop, not the mechanism — the conversation lock lives in
 * the server's memory and is pushed on the dashboard stream — but it covers
 * what a push cannot: the stream being down, an event arriving while the tab
 * was hidden, a run that bypasses the lock manager. Skipped entirely while the
 * tab is hidden.
 *
 * ONE poll, however many readers. Two surfaces need this — the rail's per-row
 * mark and the project chip's roll-up — and both are on screen together on the
 * Chat tab. `invalidate` starts a load every time it is called, so two
 * independent intervals against one shared key would double the request rate
 * against `/api/health` for no extra truth. The interval is reference-counted
 * here instead.
 */

import { useEffect, useMemo } from 'react';
import * as skill from '../skills';
import { invalidate, useEntity } from '../store/cache';
import { K } from '../store/keys';

const POLL_MS = 4000;

let readers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  if (document.visibilityState === 'visible') invalidate(K.activeChats);
}

export function useLiveChatIds(): ReadonlySet<string> {
  const { data } = useEntity<readonly string[]>(K.activeChats, skill.getActiveChatIds);

  useEffect(() => {
    readers += 1;
    if (timer === null) {
      timer = setInterval(tick, POLL_MS);
      document.addEventListener('visibilitychange', tick);
    }
    return (): void => {
      readers -= 1;
      if (readers === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
        document.removeEventListener('visibilitychange', tick);
      }
    };
  }, []);

  return useMemo(() => new Set(data ?? []), [data]);
}
