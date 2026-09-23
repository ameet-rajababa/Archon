# Credential architecture — decision record

**Date:** 2026-09-23
**Status:** Decided, not yet executed. The runbook is
[`runbook.md`](./runbook.md).

## The problem

Credentials for agentic coding are spread across four stores with no rule about
which one is authoritative, and several of them expire on schedules nobody
tracks. The result is recurring, unplanned interruption: a run stalls on a 403,
a token turns out to have been revoked months ago, or a secret exists under two
spellings on two hosts. Over the past year this has been a continuous tax.

The goal is not fewer secrets. It is secrets that do not expire, that live in
exactly one place, and that reach every host that needs them without a human in
the loop.

### What "success" means

An agent run that needs GitHub write access, an Anthropic key, or a Healthchecks
ping URL obtains it without stopping. When a credential genuinely cannot be
obtained, the run fails immediately with the specific missing grant named — and
no other run is blocked.

## Scope

| In scope | Out of scope |
|---|---|
| GitHub App (all repos under `rajababa-io` and `ameet-rajababa`) | Supabase writer DSNs |
| A narrow classic PAT for repos not owned by the operator | Todoist |
| `ANTHROPIC_API_KEY` | Google Workspace OAuth (3 `workspace-mcp` units) |
| `GEMINI_API_KEY` | Cloudflare |
| Healthchecks (`HC_API_TOKEN`, ping URLs) | Langfuse, FalkorDB connection config |

Out-of-scope credentials are handled interactively with `op` and a browser. They
are not part of the unattended path, and their failures surface in tools the
operator is already looking at.

## Decisions

Each decision names the alternatives that were considered and the reason they
were rejected. Rejections matter more than the choices; they are what stops this
being re-litigated.

### D1 — GitHub access is a GitHub App, owned by the `rajababa-io` organization

Installed twice: once on `rajababa-io`, once on the `ameet-rajababa` personal
account. One App ID, one private key, two installation IDs.

**Why.** GitHub App private keys do not expire; they are revoked manually or not
at all. Installation tokens minted from that key last one hour and are minted
again on demand. This is the only credential type in GitHub's model that gives
"configure once, never rotate."

**Rejected — fine-grained PAT.** A fine-grained PAT has exactly one resource
owner, so it cannot serve both the org and the personal account. More decisively,
any organization it touches enforces that org's PAT lifetime policy, default
maximum 366 days, regardless of what the token creator selected. The expiry
treadmill is structural, not a configuration mistake.

**Rejected — classic PAT as the primary.** Works, but ties the credential to a
human identity, shares one 5,000/hour rate limit across everything, and offers no
path to per-repository scoping.

**Rejected — App owned by the personal account.** Functionally identical for
tokens. An org-owned App's key and settings survive independently of one person's
GitHub account, which matters for something intended to run unattended for years.

### D2 — Broad permissions, private key held only in 1Password

The App is granted Contents, Pull requests, Issues and Actions at write, Secrets
at read, Administration at write, plus the mandatory Metadata read.

**Why.** Narrow grants are what produce the 403s this work exists to eliminate.
Concentrating authority in one credential is acceptable *provided* the key itself
is protected and the token is not readable by the code it authorizes — see D9,
which is what makes this safe rather than merely convenient.

**Rejected — broad read, narrow write against a repo list.** The list becomes a
maintenance surface that is always one repo out of date.

### D3 — A second credential covers repos the operator does not own

A classic PAT, minted fresh with the minimum scopes needed to comment on, label
and close issues and open pull requests on third-party repositories.

**Why.** An App can only be installed where an owner approves it. Upstream
maintainers will not install a personal automation App on their repository.
Additionally, **no fine-grained PAT can read GitHub Actions check runs at all** —
GitHub exposes no Checks permission to them — so a classic token is the only
non-App way to reach that API.

**Rejected — one credential for everything.** Not achievable. Pretending
otherwise is what caused six upstream issue withdrawals to stall on 2026-09-23.

**Rejected — keeping the existing 21-scope classic PAT.** Superseded for
everything except third-party repos, and its scope list (`admin:org`,
`delete_repo`) vastly exceeds what that job needs.

### D4 — 1Password is the sole credential store

Archon's `remote_agent_codebase_env_vars` store retains **non-secret
configuration only** — hostnames, public keys, DSN-shaped URLs. No tokens, no
service-account credentials, no private keys.

**Why.** Archon's store injects into workflow node execution inside the container
and nowhere else. It cannot reach PID 1, adina, or the Macs. A store that reaches
one host out of three cannot be the source of truth for a three-host fleet.

**Rejected — Archon's store as truth with a write-through to 1Password.** Keeps a
UI the operator likes, but adds a synchronization mechanism whose failure mode is
two stores that silently disagree.

**Rejected — Archon's store as truth with a read API for other hosts.** That is
building a secrets service, and each host would still need a credential to call it.

### D5 — One dedicated `Automation` vault; the service account is scoped to it alone

**Why.** 1Password service account vault access is **immutable**. It cannot be
edited after creation; changing it means minting a new service account and
redistributing the token. Items, however, can be added to a vault indefinitely.
Scoping to a single purpose-built vault is therefore permanently sufficient while
keeping the automation account unable to read the 757 items in `Personal`.

**Rejected — keeping access to all seven vaults.** No migration work, but the
automation account retains read access to personal banking and identity records
for no operational benefit.

**Rejected — per-context vaults (Wodify, Bhanu, PROJ-Wix).** Real isolation, but
multiplies the service accounts and host files that must be kept current. Client
credentials are out of scope (see Scope) and can get their own decision later.

### D6 — Migrate to 1Password Business before building anything

**Why.** Business raises the account-wide ceiling from 1,000 read+write per day
to 50,000, which removes rate limiting as a design constraint entirely.

**This is a migration, not an upgrade.** 1Password's documented path from a
Families account is to create a *new* Business account and move items across.
That means a new sign-in address, every service-account token re-minted, and
items moved by hand. It must happen first: an `Automation` vault and service
account created beforehand would be discarded and rebuilt.

**Rejected — skip the upgrade and cache aggressively.** Viable, and cheaper, but
was declined in favour of removing the ceiling permanently.

### D7 — The bootstrap token lives in a file on the mounted volume

`OP_SERVICE_ACCOUNT_TOKEN` is written to a mode-600 file on the `/home/appuser`
volume and named in the compose `env_file:`.

**Why.** It must reach PID 1, because the server resolves secrets at startup. It
must also be editable without root from inside the container — on 2026-09-22 the
value in `/opt/archon/.env` was blanked and no session could repair it, which is
precisely why it was moved into Archon's database in the first place. A file on
the mounted volume satisfies both, and matches what adina already does.

### D8 — The server process is wrapped in `op run`

`/opt/archon/.env` holds `op://` secret references rather than values. `op run`
resolves them into the process environment at start.

**Why.** It is the only arrangement in which the App private key never exists as
a file. It also makes `/opt/archon/.env` safe to read, copy, and back up, which
removes a whole class of accident.

**Rejected — `GITHUB_APP_PRIVATE_KEY_PATH` pointing at tmpfs.** Simpler, and the
key is only in RAM, but it is still a readable file for the container's lifetime.

**Rejected — inline PEM in `/opt/archon/.env`.** Simplest, and puts a
never-expiring private key on the droplet's disk.

### D9 — Tokens are never injected into a node's environment

GitHub credentials are served exclusively through the git credential helper.
`echo $GH_TOKEN` inside an agent Bash call returns nothing.

**Why.** This is the decision that makes D2 safe. A token in `process.env` is
readable by every Bash tool call in an agent run, and the model can quote shell
output into a transcript verbatim. With broad permissions that discloses every
repository in the organization for up to an hour. Upstream raised this as #1467
and closed it `not planned`, so no one else is going to fix it.

### D10 — Secrets resolve at runtime, not from files at rest

Build the command-based resolver upstream requested in #2349, and contribute it
back. Resolve once at process start with an explicit command to re-read, rather
than per operation.

**Why.** Without it, 1Password is a filing cabinet rather than a resolver, and
long-lived values still sit in plaintext files. Resolving at start keeps the
number of calls small and makes a rotation live without a restart.

### D11 — Credential failures fail one run loudly; they never block

Try the App token first. On a 403 for a repository outside the installations,
fall back to the classic PAT automatically. If both fail, fail that single run
with the missing grant named — GitHub returns it in the
`x-accepted-github-permissions` response header — and let every other run
continue.

**Why.** It is the behaviour the whole effort exists to produce. A run that fails
with a precise diagnosis costs two minutes. A run that pauses for a human costs
the interruption being eliminated.

### D12 — Credentials that cannot be made permanent are monitored

Every credential with a forced expiry gets an entry in the existing adina
hc-intent registry, with an alert ahead of the expiry date, and a liveness probe
that makes a real authenticated call rather than checking that a file exists.

**Why.** Upstream #3274 is the cautionary case: an expired Anthropic grant went
undetected for three months because the check was `existsSync()`.

### D13 — The five App-mode defects are patched in the fork and upstreamed in parallel

**Why.** Waiting for upstream merges blocks the work indefinitely. Patching only
the fork means carrying and re-applying patches on every sync, forever. Doing
both is the only path that terminates.

### D14 — adina gets both a `/etc/profile.d` drop-in and explicit `EnvironmentFile=` per unit

**Why.** adina's `op` is currently broken in every non-interactive context —
`ssh adina 'op whoami'` returns `no account found for filter` — because the token
is sourced from `~/.zshenv`, which bash, cron and systemd never read. Interactive
zsh works, which is why this went unnoticed. The bug exists because one mechanism
was assumed to cover every context; naming each context is what prevents a repeat.

### D15 — Cutover is incremental, with GitHub last

AI provider keys and Healthchecks move first and prove the mechanism. GitHub
moves last, after the five blockers are patched.

**Why.** GitHub is the one where a mistake stops the operator working.

### D16 — All three existing credentials are revoked and a fresh classic PAT is minted

The fine-grained PAT, the 21-scope classic PAT, and the `production` service
account are all revoked at the end of cutover. Third-party access is re-minted
from scratch with minimum scopes.

**Why.** A clean slate inherits no unknown grants. Note this supersedes the
2026-09-23 decision to keep the 21-scope classic token as-is, which was taken
before this architecture existed.

## Constraints discovered during design

These are facts about the systems involved, not choices. They are recorded
because each one invalidated an approach that looked reasonable beforehand.

**GitHub**

- App private keys never expire and are revoked manually. Installation tokens are
  fixed at one hour and not configurable.
- Each installation has an independent rate-limit bucket (5,000/hour, scaling to
  12,500 by repo and member count). PAT limits are shared across everything one
  user does.
- Installation tokens **cannot** create a repository under a personal account
  (`POST /user/repos` is user-token-only), manage gists, star, follow, or
  authenticate to GitHub Packages outside Actions. No permission grant changes
  this; there is no user behind the token.
- **Installation token format is changing.** Since May 2026 GitHub has been
  migrating from a ~40-character opaque string to a ~520-character JWT. Nothing
  may assume token length or shape.
- An organization can suspend an installation without deleting the App; App
  policy approval is separate from installation.

**1Password**

- Service account tokens do not expire unless `--expires-in` is passed.
- Vault access is immutable. The *token* however can be rotated in place, issuing
  a replacement with identical permissions while the old one remains valid for a
  chosen overlap — so redistribution is a planned cutover, not a scramble.
- Changing an organization's sign-in address breaks tokens after a 30-day
  redirect grace.
- **1Password Environments is real but unsuitable today**: still beta, requires an
  admin policy toggle, and Connect does not support it at all. The local `.env`
  mount is desktop-app-only and cannot work on a headless host. Revisit at GA.
- The desktop-app-integrated CLI cannot run unattended — 10-minute idle timeout,
  12-hour cap, and a PolKit agent requirement on Linux.

**This installation**

- Two secret names are misspelled in Archon's store: `GEMENI_API_KEY` and
  `CLOUDFARE_API_TOKEN`. Because a missing key yields an empty string rather than
  an error, anything reading the correct spelling silently gets nothing. This
  broke the `visual` skill on 2026-09-23. adina spells the same secret
  `GEMINI_API_KEY`, so the two hosts already disagree.
- `remote_agent_user_github_tokens` exists and is empty. It is the per-user
  OAuth table (8-hour access token, 6-month refresh) and is the mechanism that
  would cover user-token-only operations if they are ever needed.
- A second, hand-written `~/.git-credential-archon` is registered as the **global**
  git credential helper. It hardcodes `GITHUB_PAT`, discards the request on stdin,
  and returns one token for every repository. It shadows the per-repository helper
  upstream installs and must be removed before App mode can work.

## Known risks carried forward

| Risk | Mitigation | Owner |
|---|---|---|
| #2828 — the `installation` webhook crashes on an App installed across two accounts, exactly this design's shape. New installations stay invisible until fixed; a restart does not recover it. | Patched in the fork as part of D13, before the second installation is added. | This plan |
| #1467 — a broad token in a node environment is readable by any agent Bash call. Closed `not planned` upstream. | D9 removes the token from node environments entirely. | This plan |
| #3036 — Archon has no model for which credential a run may use for which repository. Stopped at an architecture gate upstream. | Not solved here. Broad App permissions sharpen the question rather than answering it. | Upstream |
| #1988 — workflow nodes run with the executor's full ambient authority. | Not solved here. D9 reduces what is available to steal. | Upstream |
| The Business migration is a hand migration of 962 items. | Sequenced first (D6) so nothing is built twice. | Operator |
