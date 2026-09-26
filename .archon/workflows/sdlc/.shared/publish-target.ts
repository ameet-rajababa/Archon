/**
 * The repository this run's branch belongs to on a forge, resolved from evidence about
 * the checkout rather than from the name of a remote.
 *
 * Two nodes need that answer and neither can be wrong about it. `pr` publishes the
 * delivery there, and every later push, edit, comment and ready flip reads the identity
 * it recorded (#31). `implement` reads the pull request it was pointed at from there
 * before it is allowed to edit, and it runs before any `pr` node exists, so it has no
 * recorded identity to consume and has to establish its own.
 *
 * Both used to resolve it from the name `origin`, in prose. In a fork-style checkout
 * `origin` is the UPSTREAM — the repository the operator has no write access to and did
 * not choose — so both instructions were inverted, and the runs that behaved correctly
 * did so because the agent noticed its instruction did not fit the checkout. A contract
 * that depends on that is not a contract, so the answer is computed here instead: the
 * agent interprets the work, and the repository is decided by evidence about this branch.
 *
 * The evidence is git's own push resolution, read through `git config` rather than by
 * splitting `@{push}`'s `<remote>/<branch>` text — a branch name containing a slash
 * makes that split ambiguous, and each key below is exactly one answer:
 *
 *   1. `branch.<name>.pushRemote`  — this branch's explicit push target
 *   2. `remote.pushDefault`        — the checkout's declared push target
 *   3. `branch.<name>.remote`      — the upstream `git push -u` recorded
 *
 * With none of those set, a checkout holding exactly one remote has no second candidate
 * and that remote is the answer; anything else is unresolved. There is no fallback to
 * `origin` and no inference from a remote's name: a checkout that does not settle the
 * question yields a reason naming the two commands that would, never a guess.
 *
 * What a caller does with that reason is the caller's policy, because the two needs are
 * not the same. `pr` cannot act at all without an identity, so its script refuses. An
 * `implement` run only needs one when the work names an existing pull request, so its
 * script reports the reason and lets the guard that actually needs it stop the run —
 * demanding push configuration from a run that never touches the forge would fail work
 * that is perfectly safe to do.
 *
 * The push URL is read with `--push`, so a remote configured with a separate `pushurl`
 * resolves to where it really pushes. Only the derived host and `owner/repo` leave this
 * module: a remote URL can carry a credential (`https://<token>@host/...`), so the raw
 * value never reaches a caller, stdout, a message, or a later command line.
 */

interface Ran {
  readonly ok: boolean;
  readonly stdout: string;
}

/**
 * Exit status is the channel, and stderr is discarded rather than reported: git's
 * failure prose can quote the remote URL, and no decision here reads it.
 */
function git(...args: string[]): Ran {
  const result = Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });
  return { ok: result.exitCode === 0, stdout: result.stdout.toString().trim() };
}

/** GitHub's alternate SSH host is the same forge; nothing else is aliased. */
const SSH_ALIAS_HOSTS: Readonly<Record<string, string>> = { 'ssh.github.com': 'github.com' };

interface Identity {
  readonly host: string;
  readonly path: string;
}

/** The resolved repository, plus how this checkout said so. */
export interface PublishTarget extends Identity {
  readonly remote: string;
  readonly branch: string;
}

/**
 * Resolved, or not resolved and why. A discriminated union rather than an optional
 * target: the reason is the only thing a caller can act on when there is no target,
 * so it cannot be absent on that branch.
 */
export type TargetResolution =
  | { readonly ok: true; readonly target: PublishTarget }
  | { readonly ok: false; readonly reason: string };

/**
 * The forge identity behind a remote URL, or `undefined` when it names no single
 * repository. Credentials are dropped with the rest of the authority — they are never
 * carried into the returned value.
 */
function identity(url: string): Identity | undefined {
  let host: string;
  let path: string;

  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(.*)$/.exec(url);
  if (scheme !== null) {
    const rest = scheme[1];
    const slash = rest.indexOf('/');
    if (slash === -1) return undefined;
    const authority = rest.slice(0, slash);
    path = rest.slice(slash + 1);
    const credentialEnd = authority.lastIndexOf('@');
    host = (credentialEnd === -1 ? authority : authority.slice(credentialEnd + 1)).replace(
      /:\d+$/,
      ''
    );
  } else {
    const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(url);
    if (scp === null) return undefined;
    host = scp[1];
    path = scp[2];
  }

  host = host.toLowerCase();
  host = SSH_ALIAS_HOSTS[host] ?? host;

  const segments = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .split('/');
  if (host === '' || segments.length !== 2 || segments.some(segment => segment === '')) {
    return undefined;
  }
  return { host, path: segments.join('/') };
}

/** Where git itself would push this branch, and which setting said so. */
function configured(branch: string): { remote: string; source: string } | undefined {
  const chain = [
    `branch.${branch}.pushRemote`,
    'remote.pushDefault',
    `branch.${branch}.remote`,
  ] as const;
  for (const key of chain) {
    const value = git('config', '--get', key);
    if (value.ok && value.stdout !== '') return { remote: value.stdout, source: key };
  }
  return undefined;
}

/** Resolve the repository this checkout's current branch belongs to. */
export function resolvePublishTarget(): TargetResolution {
  const branch = git('branch', '--show-current').stdout;
  if (branch === '') {
    return {
      ok: false,
      reason:
        'HEAD is detached, so there is no branch whose repository can be resolved. The ' +
        'push configuration that settles it belongs to a named branch this run owns.',
    };
  }

  const remotes = git('remote')
    .stdout.split('\n')
    .map(name => name.trim())
    .filter(name => name !== '');
  if (remotes.length === 0) {
    return {
      ok: false,
      reason:
        `this checkout has no remotes, so branch '${branch}' belongs to no ` +
        'repository on a forge.',
    };
  }

  const declared = configured(branch);
  if (declared !== undefined && !remotes.includes(declared.remote)) {
    return {
      ok: false,
      reason:
        `${declared.source} names remote '${declared.remote}', which this checkout does ` +
        `not have (it has: ${remotes.join(', ')}). Point that setting at a remote that ` +
        'exists rather than guessing which one was meant.',
    };
  }

  const remote = declared?.remote ?? (remotes.length === 1 ? remotes[0] : undefined);
  if (remote === undefined) {
    return {
      ok: false,
      reason: [
        `branch '${branch}' has no push target and this checkout has more than one remote`,
        `(${remotes.join(', ')}), so which repository it belongs to is the operator's`,
        'choice, not a guess. In a fork checkout "origin" is the upstream, so defaulting',
        'to it would name a repository nobody chose. Settle it with "git config',
        'remote.pushDefault <remote>" for the checkout, or "git config',
        `branch.${branch}.pushRemote <remote>" for this branch alone, then resume.`,
      ].join(' '),
    };
  }

  const url = git('remote', 'get-url', '--push', remote);
  if (!url.ok || url.stdout === '') {
    return { ok: false, reason: `remote '${remote}' has no readable push URL.` };
  }

  const target = identity(url.stdout);
  if (target === undefined) {
    // The URL itself stays out of the reason: it is exactly the value that can carry a
    // credential, and naming the remote is what the operator needs to fix it.
    return {
      ok: false,
      reason:
        `the push URL of remote '${remote}' does not identify one owner/repo on a ` +
        'forge host.',
    };
  }

  return { ok: true, target: { host: target.host, path: target.path, remote, branch } };
}
