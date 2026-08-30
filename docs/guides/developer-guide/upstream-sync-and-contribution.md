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

## Sync: merge upstream at release tags, not at HEAD

Upstream moves fast (about 17 commits/day in Aug 2026, with protocol and
license changes in the mix). Chasing HEAD multiplies risk: every merge touches
app/server/protocol churn and re-triggers the channel-plane E2E gate
(`docs/lessons/2026-08-26-integration-seams-before-live-e2e.md`: gate
re-drives on code change). Syncing daily burns E2E cycles for near-zero
product value. This is the same pinned-supply doctrine the repo already uses
for the OpenClaw verticals (`docs/audits/pinned-vertical-contracts/`).

Sync when:

- an upstream release tag is cut (current: `v0.7.0-beta.2`),
- a Clisbot release is about to be cut,
- a specific upstream fix is needed (wait for the next tag, or cherry-pick
  just that fix).

Not when: "main moved again".

### Sync procedure

```bash
cd <fusion checkout>
git tag clisbot/fork-tip-$(date +%Y-%m-%d)   # mark the fork tip before merging
git fetch upstream --tags
git merge vX.Y.Z -m "Sync upstream vX.Y.Z"
# resolve the shared files below
rm package-lock.json && npm install         # regenerate the lockfile
npm run typecheck
# channel-plane E2E per docs/lessons/2026-08-26-integration-seams-before-live-e2e.md
git tag clisbot/sync-$(date +%Y-%m-%d)-vX.Y.Z
```

### Shared-file conflict surface

Since the fork point, only these files changed on both sides:

- `CLAUDE.md` — doc table; keep both sides' rows.
- `package.json` — upstream adds scripts and version/license; Clisbot adds
  the `hub`/`channels` workspaces. Keep both.
- `package-lock.json` — take neither; delete and `npm install`.
- `packages/cli/package.json` — merge dependencies.

Everything else merges clean because Clisbot's work is additive in
`packages/hub`, `packages/channels/*`, and new CLI command directories. Keep
it that way.

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
   `git push -f origin fix/<short-name>`.
6. Open the PR `longbkit/paseo:fix/<name>` → `getpaseo/paseo:main` with
   "Allow edits by maintainers" enabled and the QA evidence from
   `CONTRIBUTING.md` (commands + output, test results, screenshots/video for
   UI, platform matrix).

Hard rule: never merge the fusion branch into an upstream PR. That drags in
the whole channel plane and the PR gets rejected.

## The release gate

A Clisbot release is a tag on the fusion branch. Its notes state the upstream
tag it is based on ("based on upstream v0.7.0-beta.2"). Before cutting,
confirm the latest upstream release tag is merged in.

## Keeping the merge path cheap

The KPI is "pull N upstream commits in one afternoon and the channel plane
survives", not sync frequency. Maintain it by:

- keeping Clisbot changes additive in its own namespaces
  (`packages/hub`, `packages/channels/*`, new CLI commands);
- minimizing edits to shared files (currently 4, all metadata/docs);
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

## Reference snapshot (2026-08-30)

- Fork point: `b5f58322` (2026-08-23, "fix: update lockfile signatures and
  Nix hash [skip ci]").
- Fusion branch at snapshot: 111 commits ahead, 104 behind upstream.
- Upstream tags at snapshot: latest `v0.7.0-beta.2` (2026-08-28); main was 19
  commits ahead of it.
- Notable upstream changes since the fork point: license AGPL-3.0 →
  Apache-2.0, SSH remote daemon access, plugin Git sources, ACP steering,
  release cycle 0.5.x → 0.7.0-beta.
