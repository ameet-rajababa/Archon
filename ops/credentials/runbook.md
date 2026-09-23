# Credential architecture — runbook

**Date:** 2026-09-23
**Rationale:** [`decisions.md`](./decisions.md)

Execute in order. Phases 0–2 are prerequisites for everything else. Each step
names the host it runs on; a block with no host named is an error in this
document, not a command to guess at.

**Hosts referenced**

| Name | Reach | Notes |
|---|---|---|
| `archon` | the container running the Archon server and agent sessions | `op` is at `~/.local/bin/op` and is **not** on `PATH` |
| `adina` | `adina@100.99.204.32` | address by tailnet IP; the hostname resolves to a public Funnel address and fails misleadingly |
| the Macs | the mini and the Air | interactive use; desktop-app `op` integration is appropriate here |

**Verification discipline.** A shell that already holds an injected copy of a
value will report success after the source has broken. Verify in a clean
environment, never the one used to make the change.

---

## Phase 0 — Link the Families account, then move the work vaults

**Operator only. Nothing else in this runbook may start until this is done**, or
the vault and service accounts created later will be discarded and rebuilt.

The Business account already exists (`ameet@rajababa.io`), as does a Families
account on the same address. Being signed into both at once is supported; there
is no conflict and no urgency to remove either.

### 0a — Link the Families account and stop paying for it

1Password Business includes a **free 1Password Families membership**, and it can
be applied to the *existing* family account rather than a new one.

In the Business account, under the free-families benefit, choose **Apply to
existing account**, sign in to the Families account, and select **Apply**.

Remaining subscription time is credited and carries forward to future invoices if
the accounts are ever unlinked. Only subscription status links — no vault data is
shared between the two accounts.

> **Do not close the Families account.** It is where personal life stays, and
> linking makes it free. Closing it would discard a benefit already paid for.

### 0b — Move only the work vaults

157 items move. 805 stay.

| Vault | Items | Destination | Reason |
|---|---|---|---|
| `Personal` | 757 | **stays on Families** | personal life, not the company |
| `Bhanu` | 48 | **stays on Families** | family, not staff |
| `Development` | 60 | → Business | work |
| `Adina` | 52 | → Business | the automation runtime's credentials |
| `Shared-Adina` | 28 | → Business | work |
| `Wodify` | 9 | → Business | client |
| `PROJ-Wix` | 8 | → Business | client |
| `Automation` + `Automation-GitHub` | new | → Business | created in Phase 1; nothing to move |

Create each destination vault on the Business account first, then move items
into it. Confirm every item arrived before removing anything from the source.

**`Personal` must not move.** Beyond 1Password's own work/personal separation
guidance: personal credentials should not depend on a business subscription
remaining current, Business accounts carry admin recovery that is unwanted the
day another admin exists, and a company that restructures or changes hands should
not have personal logins entangled in it.

### 0c — Drop Adina's user seat

Adina is an automation identity, not a person who signs into the 1Password app.
Her access is served by a service account (Phase 1), so a user seat costs a
licence and grants app access nothing uses. Remove the seat once `adina-runtime`
is verified working.

### Verification

Sign in to the Business account on 1password.com and confirm the item count in
each moved vault matches the table above. Confirm the Families account still
shows `Personal` and `Bhanu`, and that its billing now reads as included.

> **Every existing service-account token stops working.** They belong to the old
> account. `production` is not migrated — it is replaced in Phase 1 and revoked
> in Phase 8.

---

## Phase 1 — Create the vaults and the two service accounts

**Operator only.** A service account cannot create a vault; that is an
account-level action.

### Why three vaults, not one

`op` reads exactly **one** `OP_SERVICE_ACCOUNT_TOKEN`, so a host holds exactly
one service account. And a service account's grant is **per vault** — there is no
item-level scoping. Those two facts together decide the vault layout:

- archon needs the GitHub credentials, the AI keys and Healthchecks.
- adina needs the AI keys and Healthchecks, plus its own out-of-scope secrets in
  `Adina` and `Shared-Adina` — Supabase writer DSNs, Todoist, Google Workspace.
- adina has no GitHub role at all.

A single `Automation` vault would therefore force adina's token to be able to
read the GitHub App private key, for no reason. Splitting the shared material
from the GitHub material costs one extra vault and keeps the App key reachable
from one host only.

| Vault | Contents | `archon-automation` | `adina-runtime` |
|---|---|---|---|
| `Automation` | Anthropic, Gemini, Healthchecks | read | read |
| `Automation-GitHub` | App private key + app id, narrow classic PAT | read | **no access** |
| `Adina` | adina's operational credentials | **no access** | read |
| `Shared-Adina` | adina's shared credentials | **no access** | read |

### Steps

On the Business account, in the 1Password web UI:

1. Create vaults `Automation` and `Automation-GitHub`. (`Adina` and
   `Shared-Adina` arrive in Phase 0b.)
2. Create service account **`archon-automation`** — `Automation` and
   `Automation-GitHub`, **read and write** (it creates and updates items), **no
   expiry**.
3. Create service account **`adina-runtime`** — `Automation`, `Adina` and
   `Shared-Adina`, **read only** unless something genuinely writes back, **no
   expiry**.
4. Copy each token. **1Password shows a token once, at creation, and never
   again.**
5. File both tokens as items in `Automation` so any host with a working `op` can
   bootstrap another. Record the item UUIDs.

> Vault access on both accounts is **immutable**. It cannot be widened later —
> that requires minting a new account and redistributing its token. Confirm the
> vault names and the grid above before creating either one.

> Omitting `--expires-in` is what makes a token permanent. Do not set an expiry:
> there is no unattended way to renew one, so an expiry guarantees the
> interruption this plan exists to remove.

**On rotation.** Vault *access* is immutable, but the *token* is not: rotating
issues a replacement with identical permissions while the old one stays valid for
a chosen overlap. Redistribution is therefore a planned cutover, not a scramble.

## Phase 2 — Distribute the bootstrap tokens

**One long-lived secret per host**, and only one — `op` reads a single
`OP_SERVICE_ACCOUNT_TOKEN`. archon receives `archon-automation`; adina receives
`adina-runtime`. Everything else on each host derives from its own token.

**On `archon`** — write the token to the mounted volume, not to `/opt/archon/.env`:

```bash
install -m 600 /dev/null ~/.op-token.env
printf 'OP_SERVICE_ACCOUNT_TOKEN=%s\n' '<paste token>' > ~/.op-token.env
```

Then add `~/.op-token.env` to the container's compose `env_file:` list so PID 1
receives it. This requires editing compose on the droplet host, as root.

**On `adina`** — fix the non-interactive gap at the same time. `op` is currently
broken in every automated context on this host; see D14.

```bash
sudo install -m 644 /dev/null /etc/profile.d/op-token.sh
printf 'export OP_SERVICE_ACCOUNT_TOKEN=%s\n' '<paste token>' | sudo tee /etc/profile.d/op-token.sh >/dev/null
sudo install -m 600 /dev/null /etc/archon/op.env
printf 'OP_SERVICE_ACCOUNT_TOKEN=%s\n' '<paste token>' | sudo tee /etc/archon/op.env >/dev/null
```

Then add `EnvironmentFile=/etc/archon/op.env` to each systemd unit that shells
out to `op` — at minimum `adina-hc-selfheal.service` and
`adina-push-receiver.service`. A drop-in is preferable to editing the unit:

```bash
sudo systemctl edit adina-hc-selfheal.service   # add [Service] and the EnvironmentFile line
sudo systemctl daemon-reload
sudo systemctl restart adina-hc-selfheal.service
```

**Verification — from `archon`, in a clean environment:**

```bash
ssh -i ~/.ssh/archon_agent_adina adina@100.99.204.32 "bash -lc 'op whoami'"
ssh -i ~/.ssh/archon_agent_adina adina@100.99.204.32 "bash -c 'op whoami'"
```

Both must succeed. The second is the one that is broken today — if it still
reports `no account found for filter`, the non-login path is not covered.

**On the Macs**, the desktop app integration is appropriate; no service-account
token is needed for interactive use.

---

## Phase 3 — Move the non-GitHub secrets

Lowest risk, and it proves the mechanism before GitHub depends on it.

**Item shells are created by the agent; values are entered by the operator.**
For each secret the agent creates an empty item with the correct title and field
names, then provides a deep link. The operator opens the link and pastes the
value. No credential passes through a chat transcript.

Items to create in `Automation`:

| Item title | Field | Replaces |
|---|---|---|
| `Anthropic API Key` | `credential` | `ANTHROPIC_API_KEY` on adina |
| `Gemini API Key` | `credential` | `GEMENI_API_KEY` (archon, misspelled) and `GEMINI_API_KEY` (adina) |
| `Healthchecks API Token` | `credential` | `HC_API_TOKEN` |
| `Healthchecks Ping URLs` | one field per named URL | the `HC_*_URL` family |

Creating a shell, on `archon`:

```bash
export PATH="$HOME/.local/bin:$PATH"
op item create --vault Automation --category "API Credential" \
  --title "Anthropic API Key" 'credential=' --format json | jq -r '.id'
```

Deep link for the operator to fill, on `archon`:

```bash
op item get <ITEM_ID> --vault Automation --format json \
  | jq -r '"https://start.1password.com/open/i?a=" + .vault.id + "&i=" + .id'
```

> **The `GEMINI` / `GEMENI` split is resolved here.** One item, one spelling,
> consumed by both hosts. Fix every consumer to read `GEMINI_API_KEY` and delete
> the misspelled key from Archon's store. A missing key yields an empty string
> rather than an error, so a consumer left on the old spelling will fail
> silently.

**Verification.** On each host, in a clean environment, resolve each reference
and confirm a non-empty value of the expected shape — never print the value.

```bash
env -i HOME=$HOME PATH=$HOME/.local/bin:$PATH \
  OP_SERVICE_ACCOUNT_TOKEN=$(grep -oP '(?<==).*' ~/.op-token.env) \
  bash -c 'op read "op://Automation/Anthropic API Key/credential" | wc -c'
```

---

## Phase 4 — Resolve secrets at runtime

**Wrap the server in `op run`.** Change `/opt/archon/.env` so it holds
references rather than values:

```
ANTHROPIC_API_KEY=op://Automation/Anthropic API Key/credential
GEMINI_API_KEY=op://Automation/Gemini API Key/credential
GITHUB_APP_ID=op://Automation-GitHub/GitHub App - archon/app_id
GITHUB_APP_PRIVATE_KEY=op://Automation-GitHub/GitHub App - archon/private_key
```

Change the container's entrypoint to start the server under `op run`, so the
values are resolved into the process environment and never written to disk.

**Build the command-based resolver** (D10, upstream #2349) so a configured value
may be a command to run rather than a literal. Resolve once at process start;
provide an explicit command to re-read after a rotation.

**Verification.** Start the server and confirm it boots. Then confirm
`/opt/archon/.env` contains no secret values — it should be safe to `cat` in
full.

---

## Phase 5 — Patch the five App-mode defects

Branch from `dev` in `rajababa-io/Archon`. Patch locally first so the work is
usable, and open the upstream pull requests in parallel (D13).

| Issue | Defect | Fix |
|---|---|---|
| #3427 | `installCredentialHelper` never sets `credential.useHttpPath`, so git sends no `path=` and the helper rejects with `malformed path ()`. Every clone fails in App mode. It also installs only on fresh clones. | Set `useHttpPath` in the repository config; add a path that repairs existing clones. |
| #3428 | `registerGitHubAppAuthProvider` is called only by the server, so `archon workflow run` — including `--detach` and cron-driven runs — executes every node with no token. | Register the provider in the CLI entrypoint too. |
| #3429 | `cloneRepository` resolves only via `resolveGitHubTokenFromEnv`; private repositories clone unauthenticated and fail. | Add the App branch to the clone path. |
| #3430 | `archon doctor` checks only `GITHUB_TOKEN`/`GH_TOKEN`, reports "GitHub not configured" in App mode, and invites a PAT that then prevents the server starting. | Teach doctor about App mode. |
| #2828 | `parseEvent` assumes every webhook has a top-level `repository`; the `installation` event has none, so the parser crashes and new installations stay invisible indefinitely. | Handle the `installation` event shape. |

**#2828 must be fixed before the second installation is added in Phase 6** — it
is triggered by exactly the org-plus-personal shape this plan uses.

**Also on `archon`, remove the shadowing helper.** This is local, not upstream:

```bash
git config --global --unset-all credential.https://github.com.helper
rm -f ~/.git-credential-archon
```

Upstream's per-repository helper then answers, which is the one the rest of the
codebase integrates with.

---

## Phase 6 — Create and install the GitHub App

**Operator creates the App**, under the `rajababa-io` organization — not the
personal account (D1).

Permissions to grant:

| Permission | Level | For |
|---|---|---|
| Metadata | Read | mandatory baseline |
| Contents | **Write** | clone, push branches, git HTTP auth |
| Pull requests | **Write** | open, update, merge |
| Issues | **Write** | create, comment, label, close |
| Actions | **Write** | re-run and cancel runs; Read alone only views them |
| Secrets | Read | names and timestamps only; values are never returned |
| Administration | **Write** | create repositories under the organization |

Install it **twice**: on `rajababa-io` (all repositories, including future ones)
and on `ameet-rajababa`.

Generate a private key and **file it directly into 1Password** — item
`GitHub App - archon` in **`Automation-GitHub`**, with fields `app_id` and
`private_key`. That vault is unreachable from adina by design.
The downloaded `.pem` is deleted immediately; it must not remain on any disk.

**Verification.** Mint an installation token and confirm write access without
writing anything. A `PUT` with an empty body to the contents API returns **422**
when the grant exists and only the body was rejected, and **403** when it does
not. Nothing is created either way.

> Do not read `"push": true` from `GET /repos/{owner}/{repo}` as evidence. That
> field reflects the *user's* role, and a public repository answers 200
> regardless.

---

## Phase 7 — Cut GitHub over

1. Set `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` as `op://` references in
   `/opt/archon/.env`; remove `GITHUB_TOKEN`.
2. Remove `GITHUB_PAT` from Archon's env-var store.
3. Confirm no GitHub token is present in any node environment (D9). `echo
   $GH_TOKEN` inside an agent Bash call must return empty.
4. Implement the fallback in D11: App token first, classic PAT on a 403 for a
   repository outside the installations, then fail that run alone with the
   missing grant from `x-accepted-github-permissions` named.

**Verification.** Run a workflow that pushes a branch and opens a pull request
against a `rajababa-io` repository, and a second that comments on an issue in a
repository outside it. The first must use the App; the second must fall back.

---

## Phase 8 — Revoke the old credentials

Only after Phase 7 has been verified (D16).

1. Mint a **new** classic PAT with the minimum scopes for third-party repository
   work — `public_repo` is sufficient for issues and pull requests on public
   repositories. File it in `Automation-GitHub`.
2. Revoke the fine-grained PAT `archon-all-repos`.
3. Revoke the 21-scope classic PAT.
4. Revoke the `production` service account.

> **`adina-runtime` must be verified working before `production` is revoked.**
> adina's out-of-scope automation — hc-selfheal, the Supabase writers, the
> workspace-mcp units — reads through `production` today. Revoking it first takes
> those down silently, and they are exactly the jobs nobody is watching.

**Then hunt the copies.** Revocation at the source leaves copies that nothing
enumerates (issue #12). Known locations:

```bash
git config --global --list | grep -i credential
grep -rl 'ghp_\|github_pat_' ~/ --include='*.env' --include='config' 2>/dev/null
grep -rl '@github.com' ~/ --include=config --include='*.sh' 2>/dev/null
```

Check `.git/config` in every workspace checkout — an inline
`https://<token>@github.com/...` URL shadows the credential helper entirely and
fails as `403 / Write access not granted`, which reads as a permissions problem
rather than a stale-credential one.

---

## Phase 9 — Monitoring

For every credential that cannot be made permanent, add an hc-intent entry on
adina with an alert ahead of the expiry date.

The probe must make a **real authenticated call**, not check that a file exists.
Upstream #3274 is the case for this: an expired Anthropic grant went undetected
for three months because the check was `existsSync()`.

After adding or removing a check, reset `expected_count` in the hc-intent
registry, or `hc_selfheal` freezes.

---

## What this does not solve

- **#3036** — Archon still has no model for which credential a run may use for
  which repository. Broad App permissions sharpen that question.
- **#1988** — workflow nodes still run with the executor's full ambient
  authority. D9 reduces what is available to steal, but does not compartmentalize.
- **User-token-only operations** — creating repositories under the personal
  account, gists, starring, following, and GitHub Packages outside Actions remain
  impossible for an installation token. Create new repositories under
  `rajababa-io`; the empty `remote_agent_user_github_tokens` table is the
  mechanism if per-user tokens are ever genuinely needed.
