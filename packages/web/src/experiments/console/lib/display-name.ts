/**
 * Per-project display-name overrides. Lives in localStorage so the rename is
 * scoped to the spike and survives reloads without backend changes.
 */
import { useEffect, useState } from 'react';

const key = (projectId: string): string => `console:displayName:${projectId}`;

const listeners = new Set<() => void>();

// localStorage can throw SecurityError in private-browsing modes or
// when storage is disabled by policy. Treat any failure as "no override
// stored" rather than crashing the rail row on mount.
export function getDisplayName(projectId: string, fallback: string): string {
  try {
    return localStorage.getItem(key(projectId)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function setDisplayName(projectId: string, value: string): void {
  const trimmed = value.trim();
  try {
    if (trimmed === '') localStorage.removeItem(key(projectId));
    else localStorage.setItem(key(projectId), trimmed);
  } catch {
    // Override won't persist; UI still updates for the current session
    // because the listeners below still fire.
  }
  for (const l of listeners) l();
}

export function useDisplayName(projectId: string, fallback: string): string {
  const [value, setValue] = useState(() => getDisplayName(projectId, fallback));
  useEffect(() => {
    const sync = (): void => {
      setValue(getDisplayName(projectId, fallback));
    };
    listeners.add(sync);
    sync();
    return (): void => {
      listeners.delete(sync);
    };
  }, [projectId, fallback]);
  return value;
}

/**
 * What to call a project on screen: the repo alone.
 *
 * The owner is already the rail's group header, and the header's second line
 * is the full path — a third copy of `owner/` crowds out the only part that
 * distinguishes one project from another. A rename is shown verbatim: the user
 * chose those words, so they are not ours to trim.
 */
export function projectLabel(name: string, displayName: string): string {
  if (displayName !== name) return displayName;
  const slash = name.indexOf('/');
  return slash === -1 ? name : name.slice(slash + 1);
}

/** `projectLabel` against the live override, for callers that only want the label. */
export function useProjectLabel(projectId: string, name: string): string {
  return projectLabel(name, useDisplayName(projectId, name));
}
