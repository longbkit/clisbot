# Upstream Sync & Contribution Playbook

How the Clisbot fusion tracks `getpaseo/paseo` and how fixes flow back to it.
Read this before syncing upstream or opening an upstream PR.

## The three repos, each with one job

- **`getpaseo/paseo` (upstream)** — read-only for us. Source of all Paseo code.
- **`longbkit/paseo` (fork)** — PR staging only. GitHub requires contribution
  PRs to come from a fork when the account has no write access to upstream:

  ```
  $ git push --dry-run upstream main:main
  ERROR: Permission to getpaseo/paseo.git denied to longbkit.
  ```

  The fork's `main` is a lazy mirror: update it when cutting a contribution
  branch. It is not a sync relay.

- **`clisbot-paseoclaw-fusion` (this repo)** — the single product line. One
  long-lived branch. Don't grow a second product line in the fork clone;
  upstream-facing work happens in the fork, everything else lands here.

## Sync policy: release baselines plus main rehearsals

Upstream moves fast. The fusion therefore separates two jobs:

- **Rehearsal:** regularly test a merge of current `upstream/main` in a clean,
  disposable worktree. Record overlap, semantic seams, dependency validation,
  typecheck, and focused tests. Never publish the rehearsal merge.
- **Promotion:** merge a named upstream release tag into the product branch.
  Run the complete gate, then publish a verified tag only after every required
  check passes.

This keeps the product reproducible without discovering months of drift at the
next release. The OpenClaw verticals remain independently pinned supply; that
external-supply policy is not evidence that the Paseo foundation should ignore
`main` between releases.

Promote when:

- an upstream release tag is cut,
- a Clisbot release is about to be cut,
- a specific upstream fix is needed (wait for the next tag, or cherry-pick
  just that fix).

Rehearse when `main` moves materially in app/server/protocol or at least once
per active development week. A rehearsal failure becomes tracked work; it does
not silently move the product baseline.

### Promotion procedure

```bash
git worktree add --detach <clean-sync-worktree> clisbot-paseoclaw-fusion
cd <clean-sync-worktree>
test -z "$(git status --porcelain)"           # required clean boundary
git tag clisbot/fork-tip-$(date +%Y-%m-%d)   # mark the product tip
git fetch --no-tags upstream refs/tags/vX.Y.Z:refs/upstream-releases/vX.Y.Z
git rev-parse refs/upstream-releases/vX.Y.Z^{} # verify against the Paseo release commit
git merge --no-commit --no-ff refs/upstream-releases/vX.Y.Z
# resolve the shared files below
npm install --package-lock-only --ignore-scripts
npm ci                                      # trusted checkout; native tools need lifecycle setup
npm ls --workspaces --depth=0
# Add exact `npm ls <package> --depth=0` checks for pins changed by the release.
npm run typecheck
# channel-plane E2E per docs/lessons/2026-08-26-integration-seams-before-live-e2e.md
git commit -m "Sync upstream vX.Y.Z"
# Fast-forward the product branch to the checked merge commit. Preserve and
# reapply any existing worktree changes, then validate overlapping paths.
# only after every required gate passes:
git tag clisbot/sync-verified-$(date +%Y-%m-%d)-vX.Y.Z
```

Paseo and Hub share this repository's local tag namespace. In the 2026-09-06
checkout, local `v0.7.0` and `v0.8.0` point to Hub releases. Fetch Paseo tags
into `refs/upstream-releases/` and verify the peeled commit before merging;
neither a bare tag name nor the root package version proves the merged baseline.
Keep a dirty product checkout intact while preparing the merge in the detached
worktree. The final branch update must preserve its tracked and untracked work.

### Shared-file overlap surface

Measure this surface again for every sync. The 2026-08-30 merge overlapped
four metadata/doc files; the 2026-09-06 comparison from `74a377ff6` to Paseo
`v0.7.2` overlaps 12 files with committed Fusion changes:

- `package.json` — upstream adds scripts and version/license; Clisbot adds
  the `hub`/`channels` workspaces. Keep both.
- `package-lock.json` — use the upstream release lock as the base and resolve
  all manifests first. Reconcile with
  `npm install --package-lock-only --ignore-scripts`, review the lock diff, and
  require clean `npm ci` plus the
  scoped `npm ls` checks below. Do not use `--ignore-scripts` for the test
  install: native tools such as `tsgo` need their package setup intact.
- `packages/cli/package.json` — update Paseo dependencies together while keeping
  the independently versioned Hub dependency.
- `packages/app/package.json`, `packages/app/src/app/_layout.tsx`, and
  `packages/app/src/components/left-sidebar.tsx` — preserve Fusion navigation
  while adopting upstream mobile animation changes.
- `packages/client/src/daemon-client.ts` and its test,
  `packages/protocol/src/messages.ts`, and `packages/server/src/server/session.ts`
  — preserve managed access and channel integration contracts.
- `packages/server/src/server/agent/providers/codex-app-server-agent.ts` and its
  test — retain Fusion behavior alongside the upstream paginated rewind fix.

These are files changed on both sides, not proof that all will conflict.
Record separately: overlap files, actual textual conflicts reported by Git,
and semantic conflicts found by validation. The `v0.7.2` merge has textual
conflicts in `package-lock.json` and `packages/cli/package.json`; the remaining
overlap auto-merges and still needs focused validation.

## Why merge, not rebase, for sync

Merge joins two parallel lines of work; rebase replays unshared commits on a
new base. The sync case is the first.

| Criterion           | Merge                                           | Rebase                                                                  |
| ------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| Fork history        | Clisbot commits keep their hashes; audit stable | every hash rewritten; the fork point stops being an ancestor of the tip |
| Conflict resolution | each shared file resolved once                  | re-resolved per replayed commit that touches the region                 |
| Push                | plain `git push`                                | force-push on every sync                                                |
| Future syncs        | next sync merges only the delta                 | replays all Clisbot commits again                                       |

Rebase wins for small unshared branches — that is what the contribution flow
below uses.

## Contributing back to upstream

1. Cut a clean branch from `upstream/main` in the fork clone — never from the
   fusion branch:

   ```bash
   cd ~/projects/paseo-forked
   git fetch upstream
   git checkout -b fix/<short-name> upstream/main
   ```

2. Bring the fix in. Write it fresh on this branch (preferred; a
   contribution is one focused change), or cherry-pick the relevant commits
   from the fusion branch:

   ```bash
   git fetch /path/to/fusion clisbot-paseoclaw-fusion
   git cherry-pick <sha>
   ```

3. Add a regression test that fails on the old code for the reported reason.
4. If upstream/main moved: `git fetch upstream && git rebase upstream/main`.
   Safe here: small branch, unshared, only you use it.
5. `npm run typecheck` plus targeted tests, then
   `git push --force-with-lease origin fix/<short-name>`.
6. Open the PR `longbkit/paseo:fix/<name>` → `getpaseo/paseo:main` with
   "Allow edits by maintainers" enabled and the QA evidence from
   `CONTRIBUTING.md` (commands + output, test results, screenshots/video for
   UI, platform matrix).

Hard rule: never merge the fusion branch into an upstream PR. That drags in
the whole channel plane and the PR gets rejected.

## The release gate

A Clisbot release is a tag on the fusion branch. Its notes state the upstream
tag it is based on. A merge commit is not a verified sync point: dependency
reproducibility, typecheck, focused tests, and required live channel evidence
must be green before creating the `sync-verified-*` tag or cutting a release.

## Keeping the merge path cheap

The KPI is "pull N upstream commits in one afternoon and the channel plane
survives", not sync frequency. Maintain it by:

- keeping Clisbot changes additive in its own namespaces
  (`packages/hub`, `packages/channels/*`, new CLI commands);
- minimizing edits to shared files and measuring the overlap at every sync;
- tracking the seam surface: which upstream symbols the channel plane
  consumes. As of 2026-08-30 that is one import of `@getpaseo/server` in
  `packages/hub/src/e2e/harness/source-paseo.ts` (dev-only E2E harness).
  Re-verify this list at every sync.

## When a vendor base becomes right

If a day comes when Clisbot must pin an old upstream release
(compliance/stability) while still backporting fixes, promote the fork to a
vendor base: that release plus a minimal backport set, with the fusion based
on it. Cost: two Clisbot diff layers to maintain and review. Don't adopt it
preemptively.

## Hygiene

- After pushing the fusion branch to `origin` (longbkit/clisbot), re-track it:
  `git branch -u origin/clisbot-paseoclaw-fusion`. Tracking `upstream/main`
  makes `git status` ahead/behind numbers meaningless for local work.
- Dev state lives in `.dev/paseo-home` inside the checkout; the packaged
  app's `~/.paseo` (port 6767) is never touched. Dev daemon: 6768; Expo: 8081. Use `npm run cli -- ...` for the dev daemon, not the global binary.
  See `docs/development.md`.

## Paseo v0.7.2 merge (2026-09-06)

The incoming release is `9400a49af670fdb5db4af58e73f8df98588dbea9`, with
19 upstream commits after the previously merged `74a377ff6` (which already
includes `v0.7.0-beta.3`). Hub stays at `0.8.0`; the channel packages stay at
`0.1.0`. The overlap and conflict resolutions are recorded above.

The lock reconciliation starts from the release lock and retains Fusion pins
where upstream did not change the dependency version. It also removes stale
Hub-local React/React DOM `19.2.7` entries and their scheduler: the Hub manifest
already requires `19.1.0`, which resolves from the root. Keeping those stale
entries made a clean install report invalid direct dependencies.

The clean merge passed `npm ci` with lifecycle scripts, `npm ls --workspaces
--depth=0`, server/CLI and channel/Hub-node builds, workspace typecheck,
formatting, lint on all 137 changed code files, and 480 focused tests
across server (271), protocol (18), client (117), app (43), and channel
control-plane/daemon-client (31). Repository-wide lint still reports 84 errors
outside the merge paths, including historical probe and revision scripts.

This is not a `sync-verified-*` release point. Live Slack/Telegram round-trips
have not been verified: the fixed `.clisbot-dev` fixture lacks the old
`secrets/slack--work` and `secrets/telegram--work` files and has no daemon on 6867. A separate Hub is already running on 6868 from `.clisbot-dev-01`; do not
reuse or restart it as if it were the fixed test fixture. Native/mobile platform
QA also remains outside this Linux merge validation.

## Reference snapshot (2026-08-30)

- Fork point: `b5f58322` (2026-08-23, "fix: update lockfile signatures and
  Nix hash [skip ci]").
- Fusion branch at snapshot: 111 commits ahead, 104 behind upstream.
- Upstream tags at snapshot: latest `v0.7.0-beta.2` (2026-08-28); main was 19
  commits ahead of it.
- Notable upstream changes since the fork point: license AGPL-3.0 →
  Apache-2.0, SSH remote daemon access, plugin Git sources, ACP steering,
  release cycle 0.5.x → 0.7.0-beta.
