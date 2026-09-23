/**
 * Resolve the repository this run's branch will actually publish to.
 *
 * The `pr` node's recorded identity is the run's authority for every later push, edit,
 * comment and ready flip, and #31 made every consumer read it instead of re-deriving
 * one. That leaves this the only place a wrong repository can enter a delivery, and the
 * one place a wrong value cannot be caught later: every consumer faithfully uses
 * whatever was recorded.
 *
 * It used to be resolved from the name `origin`, in prose. In a fork-style checkout
 * `origin` is the UPSTREAM — the repository the operator has no write access to and did
 * not choose — so the instruction was inverted, and the runs that published correctly
 * did so because the agent noticed its instruction did not fit the checkout. A contract
 * that depends on that is not a contract, so the answer is computed here instead: the
 * agent interprets the work, and the publish target is decided by evidence about this
 * branch.
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
 * and that remote is the answer; anything else stops the run. There is no fallback to
 * `origin` and no inference from a remote's name: a checkout whose target cannot be
 * determined is a hard failure that names the two commands that settle it, because
 * publishing a completed delivery to the wrong repository is the failure this exists to
 * prevent.
 *
 * The push URL is read with `--push`, so a remote configured with a separate `pushurl`
 * resolves to where it really pushes. Only the derived host and `owner/repo` leave this
 * script: a remote URL can carry a credential (`https://<token>@host/...`), so the raw
 * value never reaches stdout, a message, or a later command line.
 */

import { emit, refuse } from '../../.shared/io.ts';

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

function resolve(): void {
  const branch = git('branch', '--show-current').stdout;
  if (branch === '') {
    refuse(
      'resolve-publish-target: HEAD is detached, so there is no branch to publish. A ' +
        'pull request needs a named branch this run owns.'
    );
    return;
  }

  const remotes = git('remote')
    .stdout.split('\n')
    .map(name => name.trim())
    .filter(name => name !== '');
  if (remotes.length === 0) {
    refuse(
      `resolve-publish-target: this checkout has no remotes, so branch '${branch}' has ` +
        'nowhere to publish.'
    );
    return;
  }

  const declared = configured(branch);
  if (declared !== undefined && !remotes.includes(declared.remote)) {
    refuse(
      `resolve-publish-target: ${declared.source} names remote '${declared.remote}', ` +
        `which this checkout does not have (it has: ${remotes.join(', ')}). Point that ` +
        'setting at a remote that exists rather than guessing which one was meant.'
    );
    return;
  }

  const remote = declared?.remote ?? (remotes.length === 1 ? remotes[0] : undefined);
  if (remote === undefined) {
    refuse(
      [
        `resolve-publish-target: branch '${branch}' has no push target and this checkout`,
        `has more than one remote (${remotes.join(', ')}), so which repository this`,
        "delivery publishes to is the operator's choice, not a guess. In a fork checkout",
        '"origin" is the upstream, so defaulting to it would publish a completed delivery',
        'to a repository nobody chose. Settle it with "git config remote.pushDefault',
        `<remote>" for the checkout, or "git config branch.${branch}.pushRemote <remote>"`,
        'for this branch alone, then resume.',
      ].join(' ')
    );
    return;
  }

  const url = git('remote', 'get-url', '--push', remote);
  if (!url.ok || url.stdout === '') {
    refuse(`resolve-publish-target: remote '${remote}' has no readable push URL.`);
    return;
  }

  const target = identity(url.stdout);
  if (target === undefined) {
    // The URL itself stays out of the message: it is exactly the value that can carry a
    // credential, and naming the remote is what the operator needs to fix it.
    refuse(
      `resolve-publish-target: the push URL of remote '${remote}' does not identify one ` +
        'owner/repo on a forge host.'
    );
    return;
  }

  emit({ host: target.host, path: target.path, remote, branch });
}

resolve();
