# Upstream Sync & Contribution Playbook

How the Clisbot fusion tracks `getpaseo/paseo` and how fixes flow back to it.
Read this before syncing upstream or opening an upstream PR. The channel
verticals track a second upstream — OpenClaw — on its own mechanism; that one
is [OpenClaw channel source manifests](#openclaw-channel-source-manifests).

**Rebrand decision, 2026-09-29:** the target product branch is a fully branded
Clisbot `main`. Each upstream snapshot will be renamed before it is merged;
see the [decision and Git evidence](../../audits/2026-09-29-clisbot-rebrand-upstream-sync-decision.md).
The branch cutover is not implemented yet. The rename script and transformed
snapshots are being tested on isolated branches; the existing commands below
describe the current `clisbot-paseoclaw-fusion` branch until that migration is
complete.

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

- **`clisbot-paseoclaw-fusion` (this repo today; `main` after cutover)** — the
  single product line. One long-lived branch. Don't grow a second product line
  in the fork clone; upstream-facing work happens in the fork, everything else
  lands here.

Publication identity uses additional contextual rules in
`scripts/rebrand-templates/publication.mjs`: shared Clisbot image references,
Long Luong / `clisbot@gmail.com`, removal of inherited testimonial displays,
and exclusion of archived upstream blog articles. See the
[publication review](../../audits/2026-09-30-clisbot-branding/publication-review.md)
for retained source credit and unresolved publication claims. Container modes
are owned by [the Docker guide](../../docker.md#service-modes).

Clisbot serves one shared UI on daemon port `6868`; Hub port `6870` is backend
only. The optional daemon Hub proxy, runtime UI hint and Hub dashboard filter
are Fusion extensions, not text substitutions. Preserve their hooks during
merge and run the focused checks listed in the
[publication review](../../audits/2026-09-30-clisbot-branding/publication-review.md#one-ui-and-a-backend-only-hub).

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

### Prepare Fusion before the one-time cutover

1. Implement the repeatable rename transformation and apply it to the current
   `clisbot-paseoclaw-fusion` branch. Commit the completed Clisbot rebrand there;
   check paths, source, generated output, and product documentation for old
   names. This first step removes the branch's current mixed naming.
2. Pick the upstream release tag to become the initial official baseline.
   Fetch its raw commit, create a disposable branch from it, run the same
   transformation over the upstream snapshot, and commit that result.
3. Merge the transformed upstream branch into the fully rebranded Fusion
   branch. Resolve source conflicts by keeping the upstream functional changes
   with Clisbot names. Rerun the rename and old-name scan, reconcile the
   lockfile, and pass the build, typecheck, focused tests, and release gates.
4. Put the verified merge result at the tip of `clisbot-paseoclaw-fusion` and
   record its exact SHA. Delete the disposable sync branch name after the merge.
   This verified Fusion SHA is what the cutover pushes to `origin/main`.

For step 3, use the transformed-upstream Git sequence below with
`clisbot-paseoclaw-fusion` in place of `main`, and with its clean worktree in
place of `<main-worktree>`. The recurring procedure below targets `main` only
after the cutover.

### One-time cutover: make Fusion the Clisbot `main`

This step comes **after** the rebranded Fusion branch has merged the selected
transformed upstream baseline and passed its gates. It comes **before** later
upstream promotions directly into `main`. Do not push the current partially
branded Fusion tip as the final product.

The old GitHub `main` was backed up on 2026-09-29 as
`origin/clisbot-v1-tmux-acp-deprecated` at `21baca297f5995fb1dd3d0dc354d64a252dba9e9`.
Before cutover, verify that this backup still points to the old `origin/main`
commit. The current `main` and Fusion branch have no common ancestor, so a
normal fast-forward push cannot make Fusion the new `main`. Use a lease tied to
the verified old-main commit; if `main` moved, stop and review the new tip.

```bash
git ls-remote --heads origin main clisbot-v1-tmux-acp-deprecated
# After full rebrand and validation, record the exact approved Fusion commit.
git rev-parse clisbot-paseoclaw-fusion
git push --force-with-lease=refs/heads/main:<verified-old-main-sha> origin <verified-fusion-sha>:refs/heads/main
git ls-remote --heads origin main clisbot-v1-tmux-acp-deprecated
```

The final check must show `main` at the approved Fusion SHA and the backup at
its original SHA. Only then does the promotion procedure below apply to the
official Clisbot `main`.

### Recurring promotion procedure after the rebrand cutover

1. Fetch a named upstream release into `refs/upstream-releases/` and verify its
   commit. Make a disposable sync branch from that **raw** commit.
2. Run the version-controlled, deterministic rename transformation from the
   Fusion worktree against the upstream snapshot, including paths and product
   documentation. Verify it is idempotent, review every remaining Paseo-name
   match, then commit the transformed snapshot on the sync branch.
3. Merge the transformed branch into Clisbot `main` in a clean worktree.
   Resolve overlaps by retaining upstream functional changes with Clisbot
   names. Git may report the same renamed line again: its merge base is the
   previous raw upstream commit, not the previous transformed snapshot.
4. Rerun the transformation and old-name scan on the merged tree. Reconcile
   dependency manifests and lockfile; run the build, typecheck, focused tests,
   and required live/release gates. Commit the merge only after review.
5. Delete the disposable sync branch name and create the verified sync tag.
   The merge commit keeps the transformed snapshot and raw upstream history;
   no old `sync/rebranded-*` branch names need to remain.

### Current rename rules and remaining-name review

The test branch's [rename script](../../../scripts/rebrand-clisbot.mjs) applies
the following rules to Git-tracked paths and UTF-8 text. These are string and
path rules, not a semantic determination that every retained old name is valid.

| Input                                                                                                                                                                                               | Current rule                                                                                                                                                                                                                                                                                                                                                                                | Review when syncing                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/audits/**`; `docs/lessons/**`; `docs/overview/product-vision.md`; this playbook; the rename script, its test, `scripts/rebrand-templates/**`, `scripts/branding/**`, and `assets/branding/**` | Preserve the entire path and contents.                                                                                                                                                                                                                                                                                                                                                      | Historical and legal provenance can retain Paseo, but protection does not make every statement in these files current.                                                                                                                                                            |
| Root `LICENSE`                                                                                                                                                                                      | Prepend a scoped Clisbot copyright notice for Long Luong from `license-clisbot-notice.txt`; retain the complete upstream file verbatim below it. Skip general name replacement.                                                                                                                                                                                                             | Apache-2.0 terms and upstream notices remain intact. Review unfamiliar existing Clisbot notices before changing them. The README License rule also stops on unfamiliar upstream legal text.                                                                                       |
| `getpaseo/paseo-relay`                                                                                                                                                                              | Preserve this exact external repository identity.                                                                                                                                                                                                                                                                                                                                           | Confirm each reference still points to the upstream relay, rather than presenting it as a Clisbot-owned service.                                                                                                                                                                  |
| `getpaseo/paseo`, `@getpaseo/*`, other `getpaseo` text                                                                                                                                              | Rewrite the first to `longbkit/clisbot` and the package scope to `@clisbot/*`. The general lowercase replacement leaves `getpaseo` intact because it skips `paseo` immediately after `get`.                                                                                                                                                                                                 | This broad exception can retain unrelated GitHub identities and examples; review each remaining match.                                                                                                                                                                            |
| `app.paseo.sh`, `relay.paseo.sh`, `hub.paseo.sh` with `--keep-upstream-endpoints`                                                                                                                   | Preserve the live upstream service hosts, including escaped host patterns. Plain site and documentation links to `paseo.sh` become `clisbot.com`.                                                                                                                                                                                                                                           | Use this flag only on the isolated test branches. Without it, the hosts are transformed for Clisbot; confirm replacement services before cutover.                                                                                                                                 |
| `PASEO`, `Paseo`, `paseo` elsewhere                                                                                                                                                                 | Replace with `CLISBOT`, `Clisbot`, `clisbot` in text and paths; file-specific fixes remove collapsed aliases and set publishing/Expo ownership.                                                                                                                                                                                                                                             | The rule is case-sensitive and does not cover every mixed-case spelling or contextual claim. Review product copy and configuration after replacement.                                                                                                                             |
| Upstream Sponsor page, sponsor data, README sponsor sections, and `.github/FUNDING.yml`                                                                                                             | Replace the website files from version-controlled templates and the four README sponsor sections with neutral placeholders; clear GitHub funding options; send app Sponsor links to `clisbot.com/sponsor`.                                                                                                                                                                                  | Keep payment links and old maintainer claims out of the Clisbot UI. When Clisbot sponsorship is ready, update the templates and rule before the next sync.                                                                                                                        |
| Hub image references and release wiring                                                                                                                                                             | Use the shared `ghcr.io/longbkit/clisbot` image; Hub Compose selects `CLISBOT_RUN_MODE=hub`. The nested Hub workflow no longer publishes images.                                                                                                                                                                                                                                            | The root Docker workflow is the sole publisher; [service modes](../../docker.md#service-modes) own runtime selection.                                                                                                                                                             |
| Default service ports                                                                                                                                                                               | The contextual port transform maps daemon `6767` → `6868`, dev daemon `6768` → `6869`, and Hub defaults (`3000` / CLI `6868`) → `6870`.                                                                                                                                                                                                                                                     | Source fallbacks, app add-host defaults, SSH transport, Docker, Nix and current examples must agree. Preserve explicit user configuration and historical evidence. E2E guards block both Paseo and Clisbot ports. Do not replace unrelated `3000` timers or application examples. |
| Website operator identity                                                                                                                                                                           | Use Long Luong / `clisbot@gmail.com`; remove inherited address/VAT from the identity component.                                                                                                                                                                                                                                                                                             | Upstream copyright remains intact. Governing law and operational promises still require publication review.                                                                                                                                                                       |
| Upstream testimonials and personal blog articles                                                                                                                                                    | Remove the known testimonial wall. Archive the two inherited articles under `packages/website/posts/upstream/`, restore their original product name and credit, exclude them from blog imports, and protect the archive from rename.                                                                                                                                                        | Stop on unknown testimonial markup. Review new upstream articles individually; see [publication review](../../audits/2026-09-30-clisbot-branding/publication-review.md).                                                                                                          |
| Upstream Discord invite and old X/Reddit badges                                                                                                                                                     | Rewrite the Discord invite to `https://discord.gg/awGmcmFXC`; remove the previous maintainer's X badge and the unclaimed Reddit badge.                                                                                                                                                                                                                                                      | Review new upstream community links individually; this rule covers the known old invite and badges, not every possible new URL.                                                                                                                                                   |
| Four README introductions, concept, author, license, and attribution sections                                                                                                                       | Replace the centered tagline and subtitle, opening description, and provider-choice bullet in each locale. Insert localized Concept, author story, and Attribution sections; place the author story after Concept. Replace the known README License summary with the Clisbot summary. Remove the inherited Related projects lists; preserve the Chinese relay TLS guide as its own section. | The deliberate `Paseo` names and `getpaseo/paseo` links in Concept and Attribution identify the source project. Update the copy in the script and templates together when messaging changes.                                                                                      |

The three introductory paragraphs (desktop workspace, agent platform, and bot)
come from `scripts/rebrand-templates/readme-*-intro.md`. The script replaces the
body between `<!-- clisbot:intro:start -->` and `<!-- clisbot:intro:end -->`, so
future copy edits can update these templates and rerun the transformation.

The README's "40+ agent options" means five enabled-by-default definitions in
[the provider manifest](../../../packages/protocol/src/provider-manifest.ts)
plus 38 entries in [the ACP catalog](../../../packages/app/src/data/acp-provider-catalog.ts)
at the time of this test. Catalog entries still require their agent CLI and
configuration. Grok is a catalog preset; Antigravity is documented as a
[custom ACP provider](../../custom-providers.md). Recount and update all four
README versions and the script when either source changes.

Files with binary or invalid UTF-8 contents are skipped. `--check` verifies
that another run would make no further changes; it does **not** validate the
names left behind. After each transformed-upstream commit and after each merge,
scan both tracked contents and paths case-insensitively for `paseo`, then
classify every remaining match as provenance, an intentional test endpoint, or
work still required before release. Do not treat the table as a blanket
allowlist for new upstream text.

Also use the [Clisbot branding audit](../../audits/2026-09-30-clisbot-branding/README.md)
after transforming upstream and after resolving a merge. Its
[file inventory](../../audits/2026-09-30-clisbot-branding/inventory.md),
[favicon coverage](../../audits/2026-09-30-clisbot-branding/favicons.md), and image
evidence cover names rendered into pixels and SVG geometry that a text rename
cannot change. Compare new or changed assets and their consumers with this
baseline, including app/desktop icons, splash, Hub glyphs, website/README images,
and store screenshots. The audit counts are dated evidence, not a permanent
allowlist.

Review publication identity separately: legal/operator text, source attribution,
blog authorship, testimonials, store IDs, and external community destinations.
The audit found upstream quotations renamed to Clisbot and an unchanged upstream
App Store ID; a successful `--check` does not make those claims or destinations
correct. The [selected branding concept and backup](../../audits/2026-09-30-clisbot-branding/concept-b1-workspace-chat.md)
record the current visual direction. Apply the production kit using the following
step; the [production report](../../audits/2026-09-30-clisbot-branding/production-artifacts.md)
records its coverage and verification.

### Visual branding transform

After the text/path rename, run `scripts/branding/apply.mjs` from the Fusion
checkout against the transformed upstream worktree. It installs the versioned
[Flow / Ocean 02 kit](../../../assets/branding/clisbot/README.md) and updates
inline logo geometry and image configuration. Use the **same kit bytes** on
Fusion and upstream; do not regenerate screenshots independently on each branch.

The script defaults to a dry run. Review that report, apply it, then run `--check`.
Unknown logo geometry or missing consumers stop the batch before any writes;
review those upstream changes and update the transform before continuing.
Hub patches are skipped only when the upstream snapshot has no Hub package.
Fastlane screenshot symlinks are replaced with regular Android images to keep
the website's iPhone images independent.

Keep `scripts/branding/**` and `assets/branding/**` out of the general text rename.
They contain upstream matching anchors, artwork provenance and third-party font
licenses. Rebuild the kit in Fusion only when artwork or marketing UI changes,
then apply that revision to both sides before the next merge. After a merge,
rerun both text and visual checks and inspect newly added upstream image paths;
the manifest covers known consumers, not assets introduced by future releases.

Git command skeleton for one release, run from a clean checkout after the
cutover. `<main-worktree>` is the worktree with `main` checked out; the two
other paths are new disposable worktrees. Run the same
`scripts/rebrand-clisbot.mjs` from the Fusion checkout against each raw
upstream worktree. Stage renamed paths before `--check` because the script
enumerates the Git index.

```bash
git fetch --no-tags upstream refs/tags/vX.Y.Z:refs/upstream-releases/vX.Y.Z
git rev-parse 'refs/upstream-releases/vX.Y.Z^{}' # verify the raw upstream commit
git worktree add -b sync/rebranded-vX.Y.Z <rebrand-worktree> refs/upstream-releases/vX.Y.Z
node scripts/rebrand-clisbot.mjs --root <rebrand-worktree> --apply \
  --expo-owner lbk-company --expo-project-id 9314cc2c-4abe-4637-b1cf-647fbbfbd807
node scripts/branding/apply.mjs --root <rebrand-worktree>
node scripts/branding/apply.mjs --root <rebrand-worktree> --apply
node scripts/branding/apply.mjs --root <rebrand-worktree> --check
# In <rebrand-worktree>, install dependencies, then run npm run format and
# npm run lint. The broad rename changes wrapping in many docs/source files.
git -C <rebrand-worktree> add -A
node scripts/rebrand-clisbot.mjs --root <rebrand-worktree> --check \
  --expo-owner lbk-company --expo-project-id 9314cc2c-4abe-4637-b1cf-647fbbfbd807
git -C <rebrand-worktree> diff --cached --check
git -C <rebrand-worktree> commit -m "Rebrand upstream vX.Y.Z for Clisbot sync"

git worktree add -b sync/promotion-vX.Y.Z <promotion-worktree> main
git -C <promotion-worktree> merge --no-ff --no-commit sync/rebranded-vX.Y.Z
# Resolve conflicts; rerun the text rename/check and old-name scan.
node scripts/branding/apply.mjs --root <promotion-worktree> --check
# If needed, review and apply the visual transform; run the release gates.
git -C <promotion-worktree> add -A
git -C <promotion-worktree> diff --cached --check
git -C <promotion-worktree> commit -m "Sync rebranded upstream vX.Y.Z"

git -C <main-worktree> merge --ff-only sync/promotion-vX.Y.Z
git -C <main-worktree> tag clisbot/sync-verified-YYYY-MM-DD-vX.Y.Z
git -C <main-worktree> worktree remove <promotion-worktree>
git -C <main-worktree> worktree remove <rebrand-worktree>
git -C <main-worktree> branch -d sync/promotion-vX.Y.Z
git -C <main-worktree> branch -d sync/rebranded-vX.Y.Z
```

Stop if the final fast-forward fails because `main` moved during validation;
reconcile that movement before tagging or deleting the worktrees. Review the
staged merge diff before committing, especially lockfile changes. The current
procedure below lists the dependency and typecheck gates; add the focused and
live checks required by the release being promoted.

Use the same transform and checks for disposable `upstream/main` rehearsals.
No legacy `paseo://` handler or `PASEO_*` environment alias is part of the
target Clisbot product. The script preserves dated audits, lessons, and this
upstream playbook as historical/provenance records. During the isolated test
phase, add `--keep-upstream-endpoints` to both rename commands: live
`app.paseo.sh`, `relay.paseo.sh`, and `hub.paseo.sh` remain reachable, while
site/documentation links to `paseo.sh` become `clisbot.com`. Do not use that
flag for the official cutover. The test branches now use Expo owner
`lbk-company` and project ID `9314cc2c-4abe-4637-b1cf-647fbbfbd807`.
Confirm project access and mobile signing before running EAS builds. The
temporary service endpoints, publication identity, and native-build/storefront
appearance still need review before the cutover.

### Current promotion procedure before the cutover

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

### Tags: `refs/tags/` mirrors `origin`, nothing else

Both upstreams publish `v*` tags into the same flat namespace as our fork, and
whichever fetch ran last wins. On 2026-09-14 local `v0.8.0` pointed at the **Hub**
release, so `git checkout v0.8.0` produced the wrong repository's code, and
`git fetch upstream --tags` refused to repair it (`would clobber existing tag`).
Five of origin's own tags — `v0.1.39`, `v0.1.41`, `v0.1.43`, `v0.1.50`, `v0.1.53`
— also name a different Paseo commit.

Run `scripts/setup-git-remotes.sh` once per clone. It sets both upstreams to
branches-only, so `refs/tags/` holds our fork's releases and matches `origin`
exactly. Git config is per clone, so a fresh checkout needs it again.

Fetch an upstream release on demand, into its own namespace, and verify the
peeled commit before merging — neither a bare tag name nor the root package
version proves the merged baseline:

```bash
git fetch --no-tags upstream     refs/tags/vX.Y.Z:refs/upstream-releases/vX.Y.Z
git fetch --no-tags hub-upstream refs/tags/vX.Y.Z:refs/hub-releases/vX.Y.Z
git rev-parse refs/upstream-releases/vX.Y.Z^{}
```

A verified sync point is a tag we own, so push it: `clisbot/sync-verified-*`
belongs on `origin` like any other fork tag. Scratch markers (`clisbot/fork-tip-*`,
`backup/*`) stay local and get deleted once the sync lands.

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

`getpaseo/hub` has its own overlap, from the channel plane driving a Host over
the connection that Host holds to the Hub
([decision](../../audits/2026-09-20-channel-host-transport.md)):

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

Measure the overlap by upstream lines _replaced_, not lines added — an additive
hunk almost always merges clean. Resolve which upstream a file answers to first:
`packages/hub` maps to the **root** of `getpaseo/hub`, and each
`packages/channels/*/upstream-sync.json` carries a per-file `verbatim` /
`fusion-owned` status. Testing a path against `upstream/main` alone reports both
of those as "not upstream", which is wrong. A worked ledger of that measurement,
with a per-module why / what-if-unchanged / verdict, is
[agent session storage: upstream blast radius][session-storage-blast-radius].
Two rules it demonstrates: push a change down into a fusion-original folder rather
than into an upstream file whenever both would work, and treat a failing
upstream test as a missing feature gate rather than a stale assertion.

[session-storage-blast-radius]: ../../features/agent-session-storage/upstream-blast-radius.md

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
