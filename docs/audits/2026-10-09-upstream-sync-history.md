# Upstream sync history

Moved out of the [upstream sync playbook](../guides/developer-guide/upstream-sync-and-contribution.md)
on 2026-10-09. These sections describe steps that are done or numbers from past
syncs; the playbook keeps only what the next sync needs. Kept verbatim except
for link paths.

## Rebrand and cutover (2026-09-29 to 2026-10-01)

**Rebrand decision, 2026-09-29:** the target product branch is a fully branded
Clisbot `main`. Each upstream snapshot will be renamed before it is merged;
see the [decision and Git evidence](2026-09-29-clisbot-rebrand-upstream-sync-decision.md).
**Cutover accepted, 2026-10-01:** the user confirmed Slack works and approved
promoting `rebrand/clisbot-fusion-test` (runtime code `a21735240`) to `main`.
The acceptance record and carried follow-ups are in the
[merge audit](2026-09-30-clisbot-branding/merge-v0.10.2.md#main-cutover-acceptance-2026-10-01).
Use the recurring transformed-upstream procedure for the new product branch;
the original Fusion branch stays as a reference.

### Prepare Fusion before the one-time cutover

**Current test integration, 2026-09-30:** Paseo `v0.10.2` was selected instead of
`v0.10.1` and merged into `rebrand/clisbot-fusion-test` after user approval.
See [independent upstream validation](2026-09-30-clisbot-branding/upstream-v0.10.2-validation.md)
and [the actual merge audit](2026-09-30-clisbot-branding/merge-v0.10.2.md)
(75 files / 179 conflict hunks, normalized-base resolution, integration fixes
and remaining acceptance gates). The user accepted the resulting candidate
on 2026-10-01 after the channel packaging fix and a successful Slack test.

1. Apply and verify the repeatable text and visual rebrand on
   `rebrand/clisbot-fusion-test`, the isolated Fusion candidate. Keep
   `clisbot-paseoclaw-fusion` as the pre-cutover reference while testing.
2. Pick the upstream release tag to become the initial official baseline.
   Fetch its raw commit, create a disposable branch from it, run the same
   text and visual transformation, test it independently, and commit that result.
   The selected branch is `rebrand/upstream-v0.10.2-test`.
3. After the user's merge confirmation, merge that transformed branch into
   `rebrand/clisbot-fusion-test`. Record conflict files, causes and resolutions;
   retain upstream functionality with Clisbot names. Rerun rename and branding
   checks, reconcile the lockfile, and pass the affected build and runtime gates.
4. Record the verified candidate SHA on `rebrand/clisbot-fusion-test` and build
   the app for acceptance. A separate user confirmation authorizes promoting
   this exact SHA to `origin/main`. Keep `clisbot-paseoclaw-fusion` temporarily
   for reference. The disposable upstream branch name may be deleted after merge.

For step 3, use the transformed-upstream Git sequence below with
`rebrand/clisbot-fusion-test` in place of `main`, and with its clean worktree in
place of `<main-worktree>`. The recurring procedure below targets `main` only
after the cutover.

### One-time cutover: make Fusion the Clisbot `main`

This step comes **after** the rebranded Fusion branch has merged the selected
transformed upstream baseline and passed its gates. It comes **before** later
upstream promotions directly into `main`. Promotion requires a separate user
confirmation of the verified candidate SHA.

The 2026-10-01 approval covers runtime code `a21735240` plus the documentation
commit recording this acceptance. It retains the temporary service endpoints
and carries the audit's remaining checks as follow-up work; it does not claim
that every proposed regression check passed. Do not create a `sync-verified-*`
tag from this acceptance alone.

The old GitHub `main` was backed up on 2026-09-29 as
`origin/clisbot-v1-tmux-acp-deprecated` at `21baca297f5995fb1dd3d0dc354d64a252dba9e9`.
Before cutover, verify that this backup still points to the old `origin/main`
commit. The old `main` and Fusion branch have no common ancestor. GitHub rejected
the initial force-with-lease attempt because `main` forbids non-fast-forward
updates. Preserve the old history with a one-time `ours` merge whose first
parent is the accepted Fusion tip and second parent is old `main`. This keeps
the Fusion files and allows a normal fast-forward push without changing branch
protection. This strategy is only for replacing the retired product; never use
it for recurring upstream merges. If remote `main` moved, stop and review it.

```bash
git ls-remote --heads origin main clisbot-v1-tmux-acp-deprecated
# After full rebrand and validation, record the exact approved Fusion commit.
git switch -c sync/fusion-main-cutover <verified-fusion-sha>
git merge --no-ff --no-commit --strategy=ours --allow-unrelated-histories <verified-old-main-sha>
# Record acceptance/cutover docs, then commit. Only docs may differ from Fusion.
git commit -m "Merge accepted Fusion into main while preserving retired history"
git diff --exit-code <verified-fusion-sha> HEAD -- . ':!docs'
git merge-base --is-ancestor <verified-old-main-sha> HEAD
git push origin HEAD:refs/heads/main
git ls-remote --heads origin main clisbot-v1-tmux-acp-deprecated
```

The final check must show `main` at the cutover merge SHA and the backup at its
original SHA. The cutover tree must match the accepted Fusion code, with only
the acceptance documentation added. Only then does the promotion procedure
below apply to official Clisbot `main`.

Historical: the initial rebrand and 2026-10-01 cutover retained that temporary
exception; the [validation record](2026-09-30-clisbot-branding/evidence/upstream-v0.10.2-validation.json)
shows `appHost` and `relayHost` as `null`. The current official pairing and relay
endpoints are owned by [relay deployment](../relay-deployment.md). The branches use Expo owner
`lbk-company` and project ID `9314cc2c-4abe-4637-b1cf-647fbbfbd807`.
Confirm project access and mobile signing before running EAS builds. The
temporary service endpoints, publication identity, and native-build/storefront
appearance still need review before public release.

## Raw-upstream procedure before the cutover

Retained for provenance. Use the transformed-upstream procedure above for `main`.

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

## Shared-file overlap surface as measured for v0.7.2 (2026-09-06)

Superseded by "Seams to check every sync" in the playbook.

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
- The light theme ([design.md](../design.md), "Light palette"):
  `packages/app/src/styles/theme.ts` (light values, the optional
  `surfaceSidebarHover`, the `input`/`inputBorder` tokens),
  `packages/app/src/styles/settings.ts` (card on `surface0`),
  `packages/app/src/components/ui/form-field.tsx` and `select-field.tsx` (input
  fill and rest border), and one assertion in `theme.test.ts`. Keep the white
  cards and bordered inputs; take upstream's other edits. A trial merge of
  `upstream/main` on 2026-10-05 merged all four cleanly. Hand-styled form
  inputs paint `colors.input` instead of `surface2`, one line each, in
  `add-host-modal.tsx`, `pair-link-modal.tsx`, `provider-diagnostic-sheet.tsx`,
  `pair-device-section.tsx`, `project-settings-screen.tsx` and
  `appearance-section.tsx`; search, find, menu and read-only fields stay filled.
  Every `placeholderTextColor` reads `colors.placeholder` (a theme token the
  fork adds) instead of `foregroundMuted`: one-line edits in about 19 app files.
  An upstream input added later needs the same edit.
- The sidebar footer (since v0.11.1): upstream's footer rows (Usage, plugin
  rows) and Clisbot's bottom bar share `sidebarFooterItems`;
  `sidebar-nav/footer-model.ts` and `sidebar-nav/model.ts` each keep the other's
  keys. `left-sidebar.tsx` and `settings/sidebar/sidebar-nav-section.tsx` render both.
- Pairing (`runtime/host-runtime.ts`, `pair-link-modal.tsx`, `hosts/pair-scan-model.ts`):
  Clisbot device and Hub links run before upstream's host confirmation.
- `stores/session-store.ts` `toDaemonServerInfo` carries Clisbot's
  `botCreationAllowed` and `permissions`; an upstream rewrite that drops them
  breaks Bot creation and managed access after a reconnect.

`getpaseo/hub` has its own overlap, from the channel plane driving a Host over
the connection that Host holds to the Hub
([decision](2026-09-20-channel-host-transport.md)):

- `packages/hub/src/daemons/registry.ts` — the heaviest of the set. A Fusion
  block (`sessionChannel`, `sessionAccess`, `subscribeDaemonSession`) plus three
  edits inside live methods: the socket-close handler, the inbound dispatch
  chain, and `receiveRpcError`. Expect conflicts here first.
- `packages/hub/src/daemons/protocol.ts` — additive (`DaemonSessionChannel`,
  `DaemonSessionAccess`).
- `packages/hub/src/app.ts` and `packages/hub/src/application-runtime.ts` — one
  `publishDaemonSessions` field and a late-bound `hostSessions` thread through
  the composition root; one-line hunks, tagged `COMPAT(clisbot-control-plane)`
  like every other seam in those two files.
- `packages/hub/src/daemons/registry.test.ts` and
  `daemons/test-utils/daemon-registry-harness.ts` — appended helpers.
- `packages/hub/src/daemons/registry.session.test.ts` — a Fusion file inside an
  upstream directory.

On the Paseo side the same change adds `packages/cli/src/commands/hub/init.ts`,
`permissions.ts` and `init-flow.test.ts` (the default permission set a Hub
connection asks for), and `packages/server/src/server/session.ts` already on the
list gains the first-message agent naming.

These are files changed on both sides, not proof that all will conflict.
Record separately: overlap files, actual textual conflicts reported by Git,
and semantic conflicts found by validation. The `v0.7.2` merge has textual
conflicts in `package-lock.json` and `packages/cli/package.json`; the remaining
overlap auto-merges and still needs focused validation.

## OpenClaw apply rehearsal (2026-09-07)

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
