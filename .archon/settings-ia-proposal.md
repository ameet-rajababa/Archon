# Archon settings: inventory and information architecture

**Status:** proposal, read-only. Nothing in the codebase changed to produce this.
**Method:** every claim below was read out of source, not out of comments or docs.
Where a comment and the code disagree, the code won and the disagreement is
recorded as a finding.

---

## 1. The six worlds settings actually live in
─────────────────────────────────────────────

The problem statement says "two worlds". There are six. That is the first thing
the design has to face, because three of them already have UI and nothing labels
which is which.

```
┌───┬──────────────────────┬──────────────────────────────┬──────────────────┬─────────────────┐
│ # │ WORLD                │ STORE                        │ SCOPE            │ UI TODAY        │
├───┼──────────────────────┼──────────────────────────────┼──────────────────┼─────────────────┤
│ 1 │ Global config        │ ~/.archon/config.yaml        │ install          │ 4 of 12 keys    │
│ 2 │ Repo config          │ <repo>/.archon/config.yaml   │ project          │ none            │
│ 3 │ Per-user AI prefs    │ database row, per user       │ one person       │ 3 panels        │
│ 4 │ Per-run config       │ --config file / HTTP body    │ one run          │ none (by design)│
│ 5 │ Browser preferences  │ localStorage                 │ one browser      │ AppearancePanel │
│ 6 │ Environment vars     │ process env / .env           │ process          │ none            │
└───┴──────────────────────┴──────────────────────────────┴──────────────────┴─────────────────┘
```

Worlds 1–4 are not parallel alternatives, they are a **precedence stack** for the
keys that appear in more than one. For model bindings the stack is five deep and
is implemented in `buildAiProfile` (`packages/workflows/src/model-validation.ts:246`):

```
built-in tier defaults  →  global config  →  repo config  →  per-user row  →  per-run
      (lowest)                                                                 (highest)
```

There is already a compile-enforced registry of which keys can and cannot reach a
run: `keyClassifications` in `packages/core/src/config/run-config.ts:28`, declared
`satisfies Record<ConfigKey, KeyClassification>`. Adding a config key without
classifying it fails the type-check. **That registry is the spine this design should
hang the UI off**, rather than a second hand-maintained list — a hand-synced pair is
the defect AGENTS.md names explicitly.

---

## 2. Findings first: six settings that change nothing
─────────────────────────────────────────────────────

The invariant says a setting with no consumer must not get a UI. Six already fail
it. Three are worse than absent — they are advertised.

```
┌───────────────────────────┬──────────────────────────────────────────┬────────────────────┐
│ SETTING                   │ WHAT ACTUALLY READS IT                   │ VERDICT            │
├───────────────────────────┼──────────────────────────────────────────┼────────────────────┤
│ streaming.telegram        │ nothing. All three adapters read the      │ DEAD — and in the  │
│ streaming.discord         │ env var directly at construction         │ shipped template   │
│ streaming.slack           │ (server/src/index.ts:559,645,987)        │ and in SafeConfig  │
├───────────────────────────┼──────────────────────────────────────────┼────────────────────┤
│ concurrency.              │ nothing. The limiter reads                │ DEAD — shipped     │
│   maxConversations        │ process.env.MAX_CONCURRENT_CONVERSATIONS │ template advertises│
│                           │ (server/src/index.ts:355)                │ it as `: 10`       │
├───────────────────────────┼──────────────────────────────────────────┼────────────────────┤
│ paths.workspaces          │ nothing. Merged at config-loader.ts:553  │ DEAD — and the     │
│ paths.worktrees           │ then never read. Worktree roots come     │ worktree.path doc  │
│                           │ from getWorktreeBase (git/worktree.ts:   │ comment claims it  │
│                           │ 110), which has exactly two tiers and    │ is override tier 2 │
│                           │ consults no config path                  │                    │
├───────────────────────────┼──────────────────────────────────────────┼────────────────────┤
│ defaults.copyDefaults     │ nothing. Merged, exposed on SafeConfig,  │ DEAD — already     │
│                           │ read by no consumer                      │ @deprecated        │
├───────────────────────────┼──────────────────────────────────────────┼────────────────────┤
│ commands.autoLoad         │ nothing. Merged at config-loader.ts:613, │ DEAD               │
│                           │ read by no consumer                      │                    │
├───────────────────────────┼──────────────────────────────────────────┼────────────────────┤
│ chats.autoHandoff         │ WIRED SINCE. maybeNudgeHandoff reads it  │ LIVE — resolved    │
│                           │ and dispatches the handoff tool at a safe │ by implementing it │
│                           │ boundary, bounded at two attempts         │ (see §5 item 2)    │
└───────────────────────────┴──────────────────────────────────────────┴────────────────────┘
```

**The `chats.autoHandoff` one mattered most**, because it is the block that forced
this question. Its type doc said "Hand off automatically at this fill level, at the
next safe boundary" and nothing handed off automatically: both thresholds only sent
a message.

**RESOLVED by taking the first branch of §5 item 2** — the behaviour was implemented
rather than the field removed. `maybeNudgeHandoff` now asks the chat to call the
`handoff` tool when it crosses `handoffAtPercent`, at a safe boundary only (end of
turn, no open ask block, no paused run) and at most twice per chat, counted from a
durable notice so the bound survives a restart.

**Consequence for the layout:** `chats` gets **three** live controls. The two-control
version drawn in §4 and mock 3 is superseded.

**Why the three "advertised but dead" ones are the urgent half.** A missing setting
costs a user one search. A setting in the shipped `config.yaml` template that they
set, restart, and watch do nothing costs them an afternoon and their trust in every
other key in the file. `streaming` and `concurrency` are in `DEFAULT_CONFIG_CONTENT`
(`config-loader.ts:194`) — every install gets them written to disk as commented
examples.

---

## 3. Full inventory
────────────────────

`FOR` column: **op** = operator decision, set once, correctness matters (paths,
limits, identity). **feel** = tuned by living with it, no correct answer
(thresholds, models, appearance). **owner** = a repo maintainer's statement about
their project, not a preference.

### 3a. Global config — `~/.archon/config.yaml`

```
┌─────────────────────────┬──────────────────────┬─────────────┬────────┬──────┬──────┐
│ KEY                     │ WHAT IT DOES         │ DEFAULT     │ PER-   │ FOR  │ GOES │
│                         │                      │             │ PROJ?  │      │      │
├─────────────────────────┼──────────────────────┼─────────────┼────────┼──────┼──────┤
│ botName                 │ mention name the     │ 'Archon'    │ no     │ op   │ UI   │
│                         │ git-forge adapters   │             │        │      │      │
│                         │ answer to            │             │        │      │      │
│ defaultAssistant        │ provider when        │ first       │ YES    │ feel │ UI ✓ │
│                         │ nothing else says    │ built-in    │ (as    │      │      │
│                         │                      │ ('claude')  │ assistant)│   │      │
│ assistants.<p>.model    │ default model per    │ unset →     │ YES    │ feel │ UI ✓ │
│                         │ provider             │ SDK decides │        │      │      │
│ assistants.<p>.<other>  │ settingSources,      │ see §3e     │ YES    │ op   │ FILE │
│                         │ binary paths,        │             │        │      │      │
│                         │ additionalDirectories│             │        │      │      │
│ aliases.@<name>         │ named model presets  │ none        │ YES    │ feel │ UI ✓ │
│ tiers.{small,medium,    │ cross-provider tier  │ per-provider│ YES    │ feel │ UI ✓ │
│   large}                │ presets              │ tier-defaults│       │      │      │
│ streaming.*             │ NOTHING (§2)         │ stream/     │ no     │ —    │ DELETE│
│                         │                      │ batch/batch │        │      │      │
│ paths.*                 │ NOTHING (§2)         │ ~/.archon/* │ no     │ —    │ DELETE│
│ concurrency.            │ NOTHING (§2)         │ 10          │ no     │ —    │ DELETE│
│   maxConversations      │                      │             │        │      │      │
│ container.*             │ container isolation  │ see §3c     │ YES    │ op   │ FILE │
│ workflows.*             │ quota-failure        │ see §3d     │ YES    │ op   │ UI   │
│                         │ continuation policy  │             │        │      │      │
│ chats.nudgeAtPercent    │ suggest wrapping up  │ 40          │ no ✗   │ feel │ UI ✓ │
│ chats.handoffAtPercent  │ say it is time       │ 50          │ no ✗   │ feel │ UI ✓ │
│ chats.autoHandoff       │ automatic handoff    │ true        │ no ✗   │ feel │ UI ✓ │
└─────────────────────────┴──────────────────────┴─────────────┴────────┴──────┴──────┘
```

**✗ corrects an earlier reading of this table.** All three `chats` keys were listed
as per-project overridable because `mergeRepoConfig` merges `repo.chats` faithfully.
It does, and nothing reads the result: `resolveChatsConfig` is handed `loadConfig()`
with **no repo path**, so only `~/.archon/config.yaml` is ever consulted. A `chats:`
block in a repository config is a seventh dead setting — the same defect as §2, found
while building the panel. The Chats panel is therefore install-scoped, with no scope
toggle.

### 3b. Repo config — `<repo>/.archon/config.yaml`

No UI writes this file. There is **no `updateRepoConfig` anywhere in the
codebase** — the only config writer is `updateGlobalConfig`. That is the single
biggest structural gap: every project-scoped setting is file-only by absence of a
writer, not by decision.

```
┌──────────────────────────┬─────────────────────────────┬────────────────┬──────┬──────┐
│ KEY                      │ WHAT IT DOES                │ DEFAULT        │ FOR  │ GOES │
├──────────────────────────┼─────────────────────────────┼────────────────┼──────┼──────┤
│ assistant                │ provider for this project   │ inherit global │ feel │ UI   │
│ assistants / aliases /   │ per-project override of the │ inherit        │ feel │ UI   │
│   tiers / workflows /    │ same global keys            │                │      │      │
│   chats / container      │                             │                │      │      │
│ worktree.baseBranch      │ $BASE_BRANCH; PR base        │ unset → fails  │ owner│ UI   │
│                          │                             │ if referenced  │      │      │
│ worktree.remote          │ remote for fetch/push       │ auto-detect    │ owner│ UI   │
│ worktree.copyFiles       │ git-ignored files to copy   │ []             │ owner│ FILE │
│                          │ into a new worktree         │                │      │      │
│ worktree.initSubmodules  │ run submodule update        │ true           │ owner│ FILE │
│ worktree.path            │ repo-local worktree dir     │ unset →        │ owner│ FILE │
│                          │                             │ workspace-     │      │      │
│                          │                             │ scoped         │      │      │
│ docs.path                │ $DOCS_DIR                   │ 'docs/'        │ owner│ UI   │
│ commands.folder          │ EXTRA command folder,       │ unset — NOT    │ owner│ FILE │
│                          │ searched after              │ '.archon/      │      │      │
│                          │ .archon/commands            │ commands' as   │      │      │
│                          │                             │ its doc claims │      │      │
│ commands.autoLoad        │ NOTHING (§2)                │ true           │ —    │ DELETE│
│ defaults.copyDefaults    │ NOTHING (§2)                │ true           │ —    │ DELETE│
│ defaults.                │ load bundled commands       │ true           │ owner│ UI   │
│   loadDefaultCommands    │                             │                │      │      │
│ defaults.                │ load bundled workflows      │ true           │ owner│ UI   │
│   loadDefaultWorkflows   │                             │                │      │      │
│ recommendedWorkflows     │ pinned list on Workflows    │ []             │ owner│ UI   │
│                          │ page + run dropdown         │                │      │      │
│ env                      │ env vars for workflow nodes │ {}             │ op   │ FILE │
└──────────────────────────┴─────────────────────────────┴────────────────┴──────┴──────┘
```

### 3c. Container block (global or repo, merged per-field)

Consumed **only** in the CLI folder-project branch
(`cli/src/commands/workflow.ts:2643`). Defaults applied by
`resolveContainerBackendConfig` (`:428`), not by the loader.

| KEY | DEFAULT |
|---|---|
| `image` | `archon-runner:latest` |
| `network` | `bridge` (only `bridge`/`none` accepted; host networking refused) |
| `memoryMb` | `4096` |
| `pidsLimit` | `512` |
| `enabled` | `false` — `--container` flag wins, then workflow `container.enabled`, then this |

### 3d. Workflow continuation block

Consumed at `dag-executor.ts:11562-11595`.

| KEY | DEFAULT | NOTE |
|---|---|---|
| `autoResumeOnQuotaReset` | `false` | the master switch; the other three are inert while it is off |
| `quotaMaxAttempts` | `1` | |
| `quotaDeadlineMs` | `86_400_000` (24h) | |
| `quotaFallbackDelayMs` | unset | |

### 3e. Per-provider assistant fields

Only `model` (all providers) plus Codex's `modelReasoningEffort` and
`webSearchMode` are editable in `AssistantConfigPanel`. File-only:
`claude.settingSources`, `claude.claudeBinaryPath`, `codex.additionalDirectories`,
`codex.codexBinaryPath`, and the community-provider equivalents. Two Pi fields —
`assistants.pi.env` and `assistants.pi.maxConcurrent` — are explicitly rejected at
run scope (`run-config.ts:128-140`) because they mutate process state.

### 3f. Not config at all, but sitting in the Settings panel today

These are **credentials and browser state**, not settings. They belong in the panel
but must not be grouped with config, because their scope rules are different and
their failure modes are different.

| PANEL | STORE | SCOPE |
|---|---|---|
| `AgentsPanel` | DB, per user — provider API keys + subscription OAuth | one person |
| `GithubIdentityPanel` | DB, per user — GitHub device-flow token | one person |
| `AccountPanel` | session cookie; renders `null` when web auth is off | one browser |
| `AppearancePanel` | localStorage — theme, text size, density, light/dark, 12/24h clock | one browser |
| `SystemPanel` | read-only health/version/update-check | — |
| Project env vars | DB, per codebase — `EnvVarsDialog`, reached from `ProjectRail` | one project |

Note the **two env-var worlds**: `repoConfig.env` (file) and per-codebase DB env
vars, merged at `executor.ts:1917` with DB winning. Only the DB one has UI. A user
who sets both and gets the file value ignored has no way to see why.

---

## 4. Proposed information architecture
───────────────────────────────────────

### The organising principle

Today's panel is ordered by **implementation history**. The proposal is to order by
**one question the reader is already asking**: *whose decision is this?*

That is not a taste call — it is the axis the code already enforces. `run-config.ts`
classifies every key by lifecycle. `buildAiProfile` layers by owner. `ScopeToggle`
already renders "This install / Just me". The design's job is to stop hiding a
distinction the engine is already making.

**Four scope bands, in precedence order, top to bottom:**

```
┌──────────────────┬───────────────────────────────┬──────────────────────────────┐
│ BAND             │ MEANS                         │ WRITES TO                    │
├──────────────────┼───────────────────────────────┼──────────────────────────────┤
│ THIS INSTALL     │ everyone here, until changed  │ ~/.archon/config.yaml        │
│ THIS PROJECT     │ this repo, for everyone       │ <repo>/.archon/config.yaml   │
│ JUST ME          │ my account, any project       │ DB row                       │
│ THIS BROWSER     │ this screen, nothing else     │ localStorage                 │
└──────────────────┴───────────────────────────────┴──────────────────────────────┘
```

### Where the scope band lives in the UI

**Not** as four top-level tabs. Splitting by store would put "default model" in
three places and force the reader to know which store answers their question —
exactly today's failure, relocated.

Instead: **group by subject, and let each row carry its own scope.** One page,
sections by what the setting is about; a per-row scope chip showing which band the
current value came from, and where it is settable. This generalises the existing
`ScopeToggle` from three panels to every overridable row, which satisfies the
"express per-project override rather than flatten it" invariant without inventing
anything.

A row reading `medium → codex/gpt-5.6-terra  [project]` tells the reader the value,
its origin, and that a higher band could override it — in one line.

### Proposed layout

```
SETTINGS
│
├─ MODELS                                        [This install | This project | Just me]
│   ├─ Default agent                       …………… defaultAssistant / assistant / user row
│   ├─ Model per agent                     …………… assistants.<p>.model
│   ├─ Tiers: small / medium / large       …………… tiers.*
│   └─ Aliases: @name → provider/model     …………… aliases.*
│      · today: ModelTiersPanel + AliasesPanel + AssistantConfigPanel, three panels
│        for one subject with three separate scope toggles. Merge them.
│
├─ AGENTS & ACCESS                                                    scope: Just me
│   ├─ Provider credentials (keys, subscription login)  …… AgentsPanel, unchanged
│   └─ GitHub identity                                  …… GithubIdentityPanel, unchanged
│
├─ CHATS                                                     scope: This install
│   ├─ Suggest wrapping up at ___%          …………… chats.nudgeAtPercent      (40)
│   ├─ Hand off at ___%                     …………… chats.handoffAtPercent    (50)
│   └─ Hand off automatically      (toggle) …………… chats.autoHandoff       (true)
│      · show the resolved pair with a one-line explanation of what each does,
│        because 40 and 50 are meaningless without knowing which one speaks.
│      · BUILT. No project scope: `chats` in a repo config is merged and then
│        read by nobody — resolveChatsConfig is handed loadConfig() with no repo
│        path — so the per-project column in §3a is wrong for this key.
│
├─ WORKFLOW RUNS                                 [This install | This project]
│   ├─ Resume after a quota reset  (off)    …………… workflows.autoResumeOnQuotaReset
│   └─ Attempts / deadline                  …………… quotaMaxAttempts, quotaDeadlineMs
│      · the three numbers render disabled while the switch is off — they are
│        genuinely inert, and a live-looking control over dead config is the
│        same defect as a dead setting.
│
├─ THIS PROJECT                                                     scope: This project
│   ├─ Base branch, remote                  …………… worktree.baseBranch, .remote
│   ├─ Docs directory                       …………… docs.path
│   ├─ Recommended workflows                …………… recommendedWorkflows
│   ├─ Load bundled commands / workflows    …………… defaults.loadDefault*
│   └─ Environment variables                …………… existing EnvVarsDialog, moved here
│      · needs a repo-config writer, which does not exist yet. See §6.
│
├─ APPEARANCE                                                       scope: This browser
│   └─ Theme, text size, density, mode, clock  …………… AppearancePanel, unchanged
│
├─ SYSTEM                                                              read-only
│   └─ Status, version, concurrency, update check …………… SystemPanel, unchanged
│
├─ ACCOUNT                                             hidden when auth is off
│
└─ ADVANCED  ·  opens ~/.archon/config.yaml and <repo>/.archon/config.yaml read-only,
   with a copy-path button and a link to each file-only key's docs.
   The honest answer to "where is that setting" for everything in §5.
```

`SystemPanel`'s concurrency row is **correct and stays**. It reads
`health.concurrency` (`SystemPanel.tsx:51`), which the health route fills from
`lockManager.getStats()` (`api.ts:5296`) — the live limiter, seeded from
`MAX_CONCURRENT_CONVERSATIONS`. It shows the process truth, not the dead YAML key.
The dead key and the honest row are two different things; only the key goes.

---

## 5. What stays in the file, and why
────────────────────────────────────

This is the half that will look arbitrary later, so each one gets its own reason
rather than a shared rule. The reasons are not interchangeable — that is the point.

**`assistants.<p>.settingSources`** — changes which CLAUDE.md, skills, commands and
hooks the SDK loads. A wrong value silently changes what the agent knows, with no
error and no visible symptom until output quality drifts. A dropdown invites
experimentation with a setting whose failure is invisible. File-only keeps the blast
radius with someone who read the docstring.

**`assistants.<p>.claudeBinaryPath` / `codexBinaryPath`** — absolute paths to
executables, required only in compiled builds where SDK resolution fails. It is an
installation repair, not a preference. Anyone who needs it is already in a terminal
reading an error message.

**`codex.additionalDirectories`** — a list of absolute paths the agent may read
outside the repo. It widens the sandbox. A text field in a web UI is the wrong
affordance for granting filesystem access; it should stay somewhere that requires
file access to change.

**`container.*` (all five)** — consumed only by the CLI folder-project branch. A UI
control here would do nothing for the server-run and worktree paths, which is most
runs. Per the invariant, a control that changes nothing in the context the reader is
looking at is worse than no control. Revisit if and when the container backend is
reachable from the server.

**`worktree.copyFiles`** — a list of git-ignored paths copied into each new
worktree, typically including `.env`. Editing it in a browser makes it easy to copy
a secret into a location nobody audits. Keeping it in the repo's own file means the
decision sits next to `.gitignore`, where the reader can see what is ignored.

**`worktree.initSubmodules`** — `true` is correct for every repo with submodules and
free for every repo without (the check short-circuits). Turning it off is a
response to a specific fetch-cost problem, and the error message that prompts it
already names the key and the file (`isolation/src/errors.ts:151`). The error is a
better teacher than a checkbox.

**`worktree.path`** — repo-local worktrees require the user to add the directory to
`.gitignore` themselves; Archon deliberately does not mutate their file. A UI
toggle would land them in a state where the toggle succeeded and their repo is
dirty. A setting whose correct use requires a second manual step belongs where the
second step is obvious.

**`commands.folder`** — an *additional* search path layered between
`.archon/commands` and `.claude/commands`. Explaining that ordering costs more UI
than the setting is worth, and getting it wrong produces a command that silently
resolves to the wrong file. Note its `@default '.archon/commands'` docstring is
wrong — the real default is unset.

**`repoConfig.env`** — per-project secrets in a possibly-committed file. The DB-backed
per-codebase env vars already own this job in the UI and already win the merge. Two
UIs for two stores where one silently overrides the other is how you get a support
question that cannot be answered. Keep the file one file-only and say in Advanced
that the DB wins.

**Per-run config (`--config`, HTTP body)** — deliberately not a panel. It is one
invocation's override, validated fail-fast, sealed and encrypted per run. A run's
parameters belong on the run launcher, which is a different design question.

---

## 6. What has to be true before any of this gets built
──────────────────────────────────────────────────────

In rough order. Nothing below is in scope for this document; it is the honest cost
of the layout above.

1. **Resolve the six dead settings.** Delete `streaming`, `paths`,
   `concurrency`, `defaults.copyDefaults`, `commands.autoLoad` from the config
   surface, or wire them. Deleting a shipped key conflicts with the additive-only
   rule for the *database*; these are YAML keys with no persistence contract, and
   the loader already strips unknown keys, so removal is safe for old files. Remove
   `streaming` and `concurrency` from `DEFAULT_CONFIG_CONTENT` and from `SafeConfig`.
2. ~~**Decide `chats.autoHandoff`.**~~ DONE — implemented rather than removed, and
   now a live toggle in the Chats panel. See §2.
3. **A repo-config writer.** `updateRepoConfig` does not exist. Every "This project"
   row in §4 depends on it, plus API routes — the current four (`/api/config`,
   `/config/{aliases,assistants,tiers}`) are all install-scoped.
4. **Widen `SafeConfig`.** It omits `chats`, `workflows`, `container`, `botName`'s
   siblings and everything repo-scoped. Any row the UI shows must be readable first.
5. **Make the scope chip derive from the registry.** The UI's notion of "settable
   at which band" must come from `keyClassifications` plus one added scope field,
   not a second hand-written table. Otherwise the next `chats`-shaped block lands
   with the same "no home in the UI" problem and a stale list to boot.
6. **Fix the three wrong docstrings** found along the way: `worktree.path`'s
   precedence list (names a non-existent `paths.worktrees` tier), `commands.folder`'s
   default, `chats.autoHandoff`'s described behaviour.

---

## 7. Coverage audit: nothing exposed today may disappear
────────────────────────────────────────────────────────

Added after the fact, because the first draft of §4 silently dropped four working
controls and mis-described a fifth. Rule: **the new IA is a rearrangement, not a
reduction.** Every control that exists now must land somewhere, and if it moves,
the move is stated.

Enumerated from what the components actually render — not from their docstrings,
one of which (`tokens.css`, on the text-size picker) is already stale.

```
┌──────────────────────┬────────────────────────────────────────┬────────────────┬────────┐
│ PANEL TODAY          │ CONTROLS IT RENDERS                    │ LANDS IN       │ STATUS │
├──────────────────────┼────────────────────────────────────────┼────────────────┼────────┤
│ ModelTiersPanel      │ small/medium/large × provider + model  │ Models · Tiers │ kept   │
│                      │ + effort; scope toggle; default hint   │                │        │
│ AliasesPanel         │ name + provider + model + EFFORT;      │ Models ·       │ kept   │
│                      │ scope toggle; add/remove               │ Aliases        │ ⚠ was  │
│                      │                                        │                │ missing│
│                      │                                        │                │ effort │
│ AssistantConfigPanel │ "Chat runs on" install (provider+model)│ Models ·       │ kept   │
│                      │ "Chat runs on" just me (+ Inherit)     │ Default agent  │        │
│                      │ per-provider model grid                │ + Model per    │        │
│                      │ codex EFFORT, codex WEB SEARCH         │ agent          │ ⚠ both │
│                      │                                        │                │ missing│
│ AgentsPanel /        │ API keys, subscription OAuth login,    │ Agents &       │ kept,  │
│ AgentCredentialCard  │ add backend, label, search backends    │ access         │ as-is  │
│ AppearancePanel      │ Theme, TEXT SIZE, DENSITY, Mode,       │ Appearance     │ kept   │
│                      │ Time format, live preview              │                │ ⚠ two  │
│                      │                                        │                │ missing│
│ SystemPanel          │ status, adapter, database, version,    │ System         │ kept,  │
│                      │ CONCURRENCY, running workflows,        │                │ incl.  │
│                      │ platforms, update check                │                │ concur-│
│                      │                                        │                │ rency  │
│ GithubIdentityPanel  │ connect / disconnect GitHub            │ Agents &       │ kept   │
│                      │                                        │ access         │        │
│ AccountPanel         │ sign out (renders null when auth off)  │ Account        │ kept   │
├──────────────────────┼────────────────────────────────────────┼────────────────┼────────┤
│ OUTSIDE the settings page                                                               │
├──────────────────────┼────────────────────────────────────────┼────────────────┼────────┤
│ EnvVarsDialog        │ per-codebase env vars (DB)             │ This project · │ MOVED  │
│ (from ProjectRail)   │                                        │ Env variables  │        │
│ Project presentation │ icon, colour, rail position, brief     │ stays on the   │ NOT    │
│ (rail row menu)      │                                        │ project row    │ moved  │
└──────────────────────┴────────────────────────────────────────┴────────────────┴────────┘
```

### The five gaps this audit found in the first draft

1. **`concurrency` in SystemPanel** — §4 said "minus concurrency" on the belief the
   row showed the dead config key. It does not: it reads `health.concurrency` from
   `lockManager.getStats()`, the live limiter. **The row is truthful and stays.**
   The dead YAML key still goes; they were never the same thing.
2. **Appearance · Text size** — five steps, shipped and working. The `tokens.css`
   comment claiming the picker "stays out of the UI until it works" is stale;
   `AppearancePanel.tsx` renders it and its own docstring says the unconverted
   pixel sizes are "a known and shrinking remainder rather than a reason to
   withhold the control".
3. **Appearance · Density** — Cozy / Compact, writes `data-density`.
4. **Alias · effort** — aliases carry an optional effort rung, not just
   provider + model.
5. **Codex · effort and web search** — the only per-provider fields beyond `model`
   that are editable today.

### One piece of prior art the design should adopt, not reinvent

The per-user default assistant already offers an explicit **"Inherit (this
install)"** option (`AssistantConfigPanel.tsx:229`). That is the scope chip's idea
in a `<select>` — the lower band is named rather than implied by a blank field.
Where a row is a free-text field rather than a select, the chip carries the same
information; where it is a select, **keep the existing "Inherit" option** rather
than replacing it with a chip. Two ways to say the same thing is one too many.

### Standing rule for the next block

A new config key gets a UI row only once it has a consumer, and a new UI row must
appear in this table before it ships. `keyClassifications` already fails the
type-check when a key is added without a lifecycle classification; the same
registry, extended with a scope field, is what should drive this table — so the
audit cannot silently go out of date the way §4 did.
