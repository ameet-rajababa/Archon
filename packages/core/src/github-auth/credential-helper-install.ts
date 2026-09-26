/**
 * Install the git credential helper into a cloned worktree so long-running
 * workflows can refresh installation tokens without rewriting the remote URL.
 *
 * Flow:
 *   1. Write the bundled credential helper to `~/.archon/bin/` (idempotent;
 *      write only on first call).
 *   2. Register the helper on the worktree's git config:
 *      `credential.https://github.com.helper = ~/.archon/bin/git-credential-archon`
 *      `credential.https://github.com.useHttpPath = true`
 *
 * Both writes are required. The helper identifies the repository from the
 * `path=` line git sends on stdin, and git omits that line unless
 * `useHttpPath` is set — so a helper registered without it receives an empty
 * path, rejects the request as malformed, and exits 0. Git then falls through
 * to the next helper and the operation fails unauthenticated, which surfaces
 * as a permission error rather than a configuration one.
 *
 * The caller (the GitHub adapter clone path in App mode) decides whether to
 * invoke this — it's a no-op for PAT-mode operators by virtue of not being
 * called. The text import is embedded by Bun, so source and compiled installs
 * use the same helper without depending on the repository's `scripts/` tree.
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLogger, getArchonHome } from '@archon/paths';
import { execFileAsync } from '@archon/git';
import { credentialHelperScript } from './credential-helper-script';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('github-auth.credential-helper');
  return cachedLog;
}

/**
 * Result of installCredentialHelper.
 *
 *   installed:  helper now registered on the worktree's git config
 *   failed:     unexpected failure during copy / git-config write; the
 *               original error is attached for the caller to forward
 */
export type CredentialHelperInstallResult =
  | { kind: 'installed'; helperPath: string }
  | { kind: 'failed'; error: Error };

/** Idempotent — safe to call from every clone path. Never throws. */
export async function installCredentialHelper(
  worktreePath: string
): Promise<CredentialHelperInstallResult> {
  const binDir = resolve(getArchonHome(), 'bin');
  const helperPath = resolve(binDir, 'git-credential-archon');
  try {
    if (!existsSync(helperPath)) {
      mkdirSync(binDir, { recursive: true });
      writeFileSync(helperPath, credentialHelperScript);
      chmodSync(helperPath, 0o755);
      getLog().info({ helperPath }, 'github_auth.credential_helper_copied');
    }
    // Per-worktree git config writes — idempotent on git's side.
    await execFileAsync(
      'git',
      ['-C', worktreePath, 'config', 'credential.https://github.com.helper', helperPath],
      { timeout: 5000 }
    );
    // Without this the helper is registered but never usable: git sends no
    // `path=` line, so the helper cannot tell which repository is being
    // authenticated and declines.
    await execFileAsync(
      'git',
      ['-C', worktreePath, 'config', 'credential.https://github.com.useHttpPath', 'true'],
      { timeout: 5000 }
    );
    getLog().info({ worktreePath, helperPath }, 'github_auth.credential_helper_registered');
    return { kind: 'installed', helperPath };
  } catch (err) {
    return { kind: 'failed', error: err as Error };
  }
}
