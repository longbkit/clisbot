# Upstream Sync & Contribution Playbook

How the Clisbot fusion tracks `getpaseo/paseo` and how fixes flow back to it.
Read this before syncing upstream or opening an upstream PR. The channel
verticals track a second upstream — OpenClaw — on its own mechanism; that one
is [OpenClaw channel source manifests](#openclaw-channel-source-manifests).

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

## OpenClaw channel source manifests

Everything above is about Paseo. The packages under `packages/channels/*` also
track OpenClaw source (`~/projects/openclaw-private`), which is a different
problem: we copy files out of it rather than merge branches. Each package owns
`upstream-sync.json` and `scripts/channel-upstream-sync.mjs` reads it.

```bash
npm run channels:sync:check                                   # manifest vs tree, exit 1 on failure
npm run channels:sync:report                                  # what moved upstream since the baseline
node scripts/channel-upstream-sync.mjs check --pkg slack --strict
node scripts/channel-upstream-sync.mjs report --pkg telegram --to <commit> --json
node scripts/channel-upstream-sync.mjs apply --pkg slack --to <commit> --dry-run
node scripts/channel-upstream-sync.mjs sync-md --pkg slack    # regenerate SYNC.md's manifest section
node scripts/channel-upstream-sync.mjs restore --pkg slack [--file src/x.ts]  # rebuild a verbatim file that a formatter reflowed: upstream line shape back, local header + specifiers kept
node --test scripts/channel-upstream-sync.test.mjs       # the script's own tests
```

The upstream checkout is `$OPENCLAW_UPSTREAM_DIR` (default
`~/projects/openclaw-private`). It is read through `git`, so it can sit on any
branch — every lookup names an explicit commit.

Manifest fields:

| Field               | Meaning                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baselineCommit`    | The OpenClaw commit every `upstream` path in this manifest was read at. `apply` bumps it after a fully clean run; by hand, bump it only together with a re-read of the changed files.                                                             |
| `roots`             | `upstream` directory → `local` directory. Relative paths under a root stay identical to upstream. A root with no `upstream` is a local-only tree (a fusion-owned package).                                                                        |
| `files[].status`    | `verbatim` (byte-identical modulo the allowances below), `adapted` (upstream file, edited), `reimplemented` (written locally, usually gathering several upstream files), `fusion-owned` (no upstream source — must not carry an `upstream` path). |
| `files[].deviation` | A deviation id, or a list of them. Required for `adapted` and `reimplemented`.                                                                                                                                                                    |
| `omitted[]`         | Upstream files or directories we deliberately do not port, with the reason. A directory entry covers everything beneath it.                                                                                                                       |
| `deviations[]`      | `id`, `file`, `reason`, optional `tests`. The reason belongs here or in `DEVIATIONS.md`; the id must be referenced by at least one file entry.                                                                                                    |

What `check` fails on: a local production `.ts` under a mapped root with no
entry; an entry whose local file is gone or whose upstream path does not exist
at the baseline; a `verbatim` entry that really differs; `adapted`/
`reimplemented` without a deviation; duplicate or unreferenced deviation ids;
a deviation naming a test file that does not exist. Test files (`*.test.ts`,
`*.test-*.ts`) need no entry and are counted separately. Upstream files under a
mapped root that are neither mapped nor omitted are a warning — the remaining
port backlog — and a failure under `--strict`.

A `verbatim` comparison normalizes only three things on both sides: a line-1
`// upstream: <path>@<sha>` header, module specifiers (so import rewrites are
invisible), and trailing whitespace plus repeated blank lines. Renamed symbols,
reordered code and edited comments all fail — that is the point. Anything that
cannot survive it is `adapted`, not `verbatim`.

### Following a delta with `apply`

`apply --from <old> --to <new>` replays an upstream range onto the ported files.
It merges rather than overwrites, because the port carries two edits the copy
must keep: the line-1 header and the rewritten module specifiers. Both upstream
revisions are first moved into _local_ specifier space — the rewrite map is
derived by zipping the local file's specifiers against upstream@`--from` — and
then `git merge-file --diff3` runs with the local file as "current". The base
therefore equals the local file except where the port really drifted, which is
where a conflict is the right answer.

`--from` defaults to the manifest's own `baselineCommit`. `verbatim` entries are
the candidates; `--include-adapted` adds the `adapted` ones. Every candidate
reports `clean | conflict | unchanged | skipped(reason)`, and the run also lists
upstream files added and deleted under the mapped roots. `--dry-run` writes
nothing; without it, conflict markers land in the file. A run where every
candidate is `clean` or `unchanged` and no _mapped_ upstream file was deleted
bumps `baselineCommit` and retargets the `// upstream:` headers; `--force-baseline`
does it anyway.

An import the delta introduces is rewritten only from evidence already in the
package, never guessed: a relative import whose target the manifest maps to a
local file (the local layout is flatter than upstream's), or a bare specifier
that some other file in the package already rewrites the same way. Evidence
that disagrees, and an upstream file two local entries both claim, are reported
instead of resolved. What is left — `new upstream import "x"`, `unported import
<path>` — is the hand work, and it is why a conflict-free apply can still fail
to typecheck.

Run it per package, in dependency order, and finish one package before starting
the next: the manifest holds one baseline for the whole package, so a
half-synced package fails `check` (verbatim files at the new commit, baseline
still at the old one) until the `adapted` files are merged too.

### The 2026-09-07 rehearsal (one real week of upstream)

Rehearsed on `e54cb3cb857` → `5d8067a4483` (2026-08-30 → 2026-09-06, 163
changed production files under the channel roots) in a copy at
`/tmp/sync-rehearsal`, with the five packages rewound to the older commit so
`check` passed there first. Numbers for the `verbatim` pass:

| Package         | Mapped files changed | clean | conflict | new upstream | deleted |
| --------------- | -------------------- | ----- | -------- | ------------ | ------- |
| `markdown-core` | 25 / 54              | 25    | 0        | 4            | 0       |
| `telegram`      | 26 / 140             | 20    | 0        | 0            | 2       |
| `slack`         | 30 / 96              | 19    | 0        | 3            | 0       |
| `core`          | 104 / 327            | 56    | 0        | 633          | 72      |

120 files merged, zero conflicts, about 90 s of tool time. 118 of the 120 came
out byte-identical to the hand port at the same commit; the other two needed one
import line each, both named in the run's notes. Hand work: those two lines, and
15 upstream files added inside the range (3 `markdown-core`, 3 `slack`,
9 `core`) which have to be ported and listed — roughly 40 minutes. Afterwards
all five packages typechecked and their suites passed (`markdown-core` 654,
`core` 214, `slack` 886, `telegram` 865 of 866 — the one failure pre-exists in
the working tree — `shared` 35).

`--include-adapted` is the expensive half: 50 of the changed `adapted` files
conflicted (`core` 45, `telegram` 3, `slack` 2) because an adapted file differs
from the base in the same region the delta touches. Budget a hand resolution per
adapted file that upstream moved, and keep `adapted` for files that genuinely
need it.

Upstream also added 13 test files inside the range and 12 of them have no local
counterpart. `apply` does not surface that: test files are excluded from the
manifest and from the added/deleted lists, so upstream's new coverage has to be
swept separately.

Three things the run does not do. `core` cherry-picks files out of shared
upstream directories, so its added/deleted lists are those whole directories
(633 and 72) rather than a port backlog — the `unported import` notes are the
targeted version of the same fact. A rename arrives as one added and one deleted
file, never as a rename. And one upstream file (`fs-safe-advanced.ts`) holds a
literal NUL inside a regex class, which `git merge-file` refuses as binary; that
file reports `skipped (merge refused: …)` and the rest of the package continues.

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
