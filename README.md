# archon-ops

The scripts that build, verify, deploy and back up the Archon console on
Ameet's droplet. They live on the box at `/home/appuser/`; this branch is the
only other copy.

Kept on a branch of its own, never merged into `console`, so none of it can
ever reach an upstream PR.

| Script | What it does |
|---|---|
| `deploy-console.sh` | Build from `local/deploy`, refuse the swap if any shipped feature is missing from the bundle, swap `dist` into `/app`, restore the mockups, push the branch to `fork/console` as a backup, then run the layout smoke test. |
| `sync-upstream.sh` | Fetch `coleam00/Archon` `dev` and merge it — refusing on a dirty tree, the wrong branch, or any conflict. |
| `restore-mockups.sh` | Put `/home/appuser/mockups/*` back into `dist` after a swap, repointing each HTML file at the current hashed CSS bundle. |
| `tools/pw/smoke.mjs` | Drive chromium and fail if the document scrolls, naming the offending element. jsdom does no layout, so it cannot see an overflow bug. |

## Restoring onto a fresh box

    git clone -b ops <this fork> /tmp/ops
    cp /tmp/ops/*.sh /home/appuser/
    mkdir -p /home/appuser/.tools/pw && cp /tmp/ops/tools/pw/smoke.mjs /home/appuser/.tools/pw/
    chmod +x /home/appuser/*.sh

`deploy-console.sh` needs `GH_TOKEN` in the environment for the backup push,
and `REPO`/`BRANCH` at the top of the file to match the checkout.
