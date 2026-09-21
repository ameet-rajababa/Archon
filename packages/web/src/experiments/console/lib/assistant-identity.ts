/**
 * The assistant's color and glyph — the mark on every agent message, and the
 * face in the rail head.
 *
 * Stored PER ASSISTANT, not once for the app. Archon runs claude, codex, pi,
 * copilot and opencode, and which one answers is the thing the mark can
 * usefully say. One shared mark would only repeat what the surrounding chrome
 * already says.
 *
 * Nothing here decides WHICH assistant is being painted — the caller passes an
 * id. Inside a chat that is the conversation's own `ai_assistant_type`, which
 * is real provenance; elsewhere it is `useActiveAssistant` below. The one gap
 * left is a chat whose provider was changed after some of its messages were
 * written: every message wears the chat's current provider, because messages
 * themselves carry no provider of their own.
 *
 * localStorage, like the project identity next door and for the same reason:
 * the mark is read synchronously during render, and there is no server column
 * for it. The honest consequence is that a chosen mark does not follow you to
 * another machine.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useEntity } from '../store/cache';
import { K } from '../store/keys';
import * as skill from '../skills';
import type { UserAiPrefs } from '../skills';
import { UNSET, resolveIdentityColor, type Identity } from './identity';

const KEY = 'archon.console.assistantIdentity';

/**
 * What each shipped assistant looks like before anyone chooses.
 *
 * A table rather than the seed-derived default the projects use: a project is
 * one of many and only has to read as distinct, while `claude` gets ONE mark
 * that every message in the console wears. A hash would land it on `wine` or
 * `frown` as readily as on `sparkles`.
 *
 * Not a registry, and not required to be complete — a provider missing here
 * falls through to the deterministic default, which is why adding one costs
 * nothing. The keys are provider ids from `@archon/providers`' registry.
 * `assistant-identity.test.ts` holds the names to the picker's vocabulary.
 */
const BUILT_IN: Readonly<Record<string, Identity>> = {
  claude: { color: 'orange', glyph: 'sparkles' },
  codex: { color: 'green', glyph: 'terminal' },
  pi: { color: 'indigo', glyph: 'infinity' },
  copilot: { color: 'cyan', glyph: 'bot' },
  opencode: { color: 'plum', glyph: 'braces' },
};

type Store = Record<string, Identity>;

const listeners = new Set<() => void>();

/**
 * The parsed store, cached. Every agent message on screen reads this during
 * render, and a long chat is a hundred of them — one JSON.parse each is a cost
 * with nothing to show for it. Invalidated by the only writer below.
 */
let cached: Store | null = null;

function read(): Store {
  if (cached !== null) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    // Anything but an object means a corrupted or foreign value; start clean
    // rather than throw on every render.
    cached = typeof parsed === 'object' && parsed !== null ? (parsed as Store) : {};
  } catch {
    cached = {};
  }
  return cached;
}

/**
 * The stored identity for an assistant, falling back to its built-in one.
 *
 * Field by field, not object by object: choosing a color must not also reset
 * the glyph to the deterministic default.
 */
export function getAssistantIdentity(assistant: string): Identity {
  const stored = read()[assistant];
  const base = BUILT_IN[assistant] ?? UNSET;
  return {
    color: stored?.color ?? base.color,
    glyph: stored?.glyph ?? base.glyph,
  };
}

/**
 * A version counter, not the store itself: `useSyncExternalStore` compares
 * snapshots by identity, and `read()` hands back a fresh object on every write.
 */
let version = 0;
function snapshot(): number {
  return version;
}

export function setAssistantIdentity(assistant: string, next: Partial<Identity>): void {
  const store = { ...read() };
  store[assistant] = { ...(store[assistant] ?? UNSET), ...next };
  cached = store;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* private mode / quota — the mark still changes for this session */
  }
  // Every avatar on screen is stale the moment this changes.
  version++;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

/** What to paint an assistant with, re-rendering the caller when it changes. */
export function useAssistantIdentity(assistant: string): { identity: Identity; color: string } {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const identity = getAssistantIdentity(assistant);
  return { identity, color: resolveIdentityColor(assistant, identity) };
}

const ACTIVE_KEY = 'archon.console.activeAssistant';

/** Archon's own default when nothing has resolved yet — the first built-in provider. */
const FALLBACK_ASSISTANT = 'claude';

function rememberedAssistant(): string {
  try {
    return localStorage.getItem(ACTIVE_KEY) ?? FALLBACK_ASSISTANT;
  } catch {
    return FALLBACK_ASSISTANT;
  }
}

/**
 * Which assistant is configured to answer a NEW chat: the per-user default when
 * the caller has a web identity, otherwise the install default. An existing
 * chat declares its own and should be preferred over this.
 *
 * Both reads are cached app-wide by key, so a hundred avatars cost one fetch
 * of each. Until they land this returns the last assistant this browser saw —
 * the alternative is every chat opening with the wrong mark for a frame and
 * then swapping it, which is more distracting than a mark that is briefly
 * stale for someone who switched providers on another machine.
 */
export function useActiveAssistant(): string {
  // A 401 here just means no web identity (solo-PAT or logged out); the
  // install default is the right answer in that case and `data` stays
  // undefined, so the fallthrough below already handles it.
  const { data: prefs } = useEntity<UserAiPrefs>(K.userAiPrefs, skill.getUserAiPrefs);
  const { data: config } = useEntity(K.config, skill.getConfig);
  const chosen = prefs?.defaultProvider ?? '';
  const resolved = chosen !== '' ? chosen : (config?.config.assistant ?? null);

  useEffect(() => {
    if (resolved === null) return;
    try {
      localStorage.setItem(ACTIVE_KEY, resolved);
    } catch {
      /* the next first paint guesses again; nothing else depends on this */
    }
  }, [resolved]);

  return resolved ?? rememberedAssistant();
}
