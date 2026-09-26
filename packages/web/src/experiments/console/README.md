# Console

The console is Archon's only shipped Web application. Its historical directory
name remains in place to avoid a mechanical move while the builder is changing.

## Routes

- `/console` → all runs
- `/console/settings` → assistant, provider, system, and identity settings
- `/console/builder` → experimental workflow builder and project picker
- `/console/builder/:name` → edit a project workflow selected by
  `?project=<id>`
- `/console/r/:runId` → run detail without requiring a project URL
- `/console/p/:projectId` → project runs
- `/console/p/:projectId/chat` → project operator chat
- `/console/p/:projectId/r/:runId` → project-scoped run detail

## Ownership

- Console API calls live in `skills/`.
- Reactive data lives in `store/cache.ts`.
- Generated API shapes come from `@/lib/api.generated`.
- Shared application code is limited to authentication, generated API types,
  node-reference parsing, IDE links, and global styling.
- The `builder/` subtree remains experimental and keeps its own pure model,
  validation, editor, and serialization layers.

## Chat behavior

The composer accepts up to five files of 10 MB each. A new conversation must be
created with a text-only first message because conversation creation uses JSON;
the UI asks the operator to attach files on the next turn.

On authenticated installations, the console requests the signed-in user's
project conversation and sends the active identity with each turn. Solo
installations operate without an identity.

## Browser suite

`packages/web/e2e/` loads the built console in Chromium and asserts rendered
content — the rail lists chats, a chat shows its transcript, the composer takes
text, an ask block draws cards rather than a JSON code block. Every other check
in this repository is static, so all of them stay green while the bundle renders
a blank page. CI runs it as the `console-browser` job on every pull request.

Run it locally:

```bash
bun run build:web                        # the suite loads dist/, so build first
cd packages/web
npx playwright install chromium          # once
npx playwright test
```

It needs **Node on `PATH`** — Playwright's runner does not run under Bun. Files
are named `*.e2e.ts` rather than `*.spec.ts` so the repository's Bun inventory
never tries to collect them; the `e2e/` directory is this suite's inventory, and
a new file there runs by having been written.

`ARCHON_E2E_CHROMIUM_ARGS` passes extra flags to Chromium for a sandbox that
needs them — `ARCHON_E2E_CHROMIUM_ARGS='--no-sandbox' npx playwright test`. Do
not reach for `--single-process`: it tears the browser down with the first
`BrowserContext`, so every second test fails to open a page.

## Persisted view preferences

| Key | Default | Purpose |
| --- | --- | --- |
| `archon.console.detailView` | `log` | Run-detail tab |
| `archon.console.showToolCalls` | `1` | Show tool calls in the stream |
| `archon.console.showSystem` | `0` | Show system events |
| `archon.console.runNodeFilter` | `all` | Filter the run stream by node |
| `archon.console.railWidth` | unset | Project rail width |
| `archon.console.lastWorkflow` | unset | Last selected workflow |
| `archon.console.builderProject` | unset | Builder project selection |

Local storage reads are guarded and fall back to these defaults.
