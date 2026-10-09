# Upstream Sync & Contribution Playbook

How Clisbot tracks `getpaseo/paseo` and how fixes flow back to it. Read it before
syncing upstream or opening an upstream PR. The channel verticals track a second
upstream, OpenClaw, on their own mechanism:
[OpenClaw channel source manifests](#openclaw-channel-source-manifests).

Each upstream release is renamed to Clisbot before it is merged
([decision](../../audits/2026-09-29-clisbot-rebrand-upstream-sync-decision.md)).
How Clisbot `main` got here (the 2026-10-01 cutover, the earlier raw-upstream
procedure, past merges) is in the
[sync history](../../audits/2026-10-09-upstream-sync-history.md). Past merge
audits: [v0.10.2](../../audits/2026-09-30-clisbot-branding/merge-v0.10.2.md),
[v0.11.1](../../audits/2026-09-30-clisbot-branding/merge-v0.11.1.md).

## The three repos

- **`getpaseo/paseo` (upstream)**: read-only for us.
- **`longbkit/paseo` (fork)**: staging for upstream PRs only. GitHub needs a fork
  because the account cannot push to upstream. Its `main` is a lazy mirror.
- **`longbkit/clisbot:main`**: the one product line. Everything that is not an
  upstream PR lands here.

Clisbot serves one UI on daemon port `6868`; Hub port `6870` is backend only.
The daemon Hub proxy, runtime UI hint and Hub dashboard filter are Clisbot
extensions, not text substitutions; keep their hooks through a merge
([publication review](../../audits/2026-09-30-clisbot-branding/publication-review.md#one-ui-and-a-backend-only-hub)).

## When to sync

- **Promotion** merges a named upstream release tag into `main` and runs every
  gate below. Promote when upstream tags a release, before a Clisbot release, or
  when you need an upstream fix (or cherry-pick just that fix).
- **Rehearsal** test-merges current `upstream/main` in a disposable worktree
  through step 6, records the result, and is thrown away. Rehearse when upstream
  `main` moves materially in app/server/protocol, or once per active week. A
  failed rehearsal becomes tracked work, never a moved baseline.

## Procedure

Budget a day. v0.11.1 (244 upstream commits) produced 318 conflicting files and
56 compile errors that Git did not flag. Work in worktrees on a disk with room
(each needs its own `npm ci`, about 3 GB). Keep logs and scratch output outside
the repo, or in `.debug/scratch/`.

### 1. Fetch the release and transform it

```bash
git fetch --no-tags upstream refs/tags/vX.Y.Z:refs/upstream-releases/vX.Y.Z
git rev-parse 'refs/upstream-releases/vX.Y.Z^{}'      # record the raw commit
git worktree add -b sync/rebranded-vX.Y.Z <rebrand-wt> refs/upstream-releases/vX.Y.Z
node scripts/rebrand-clisbot.mjs --root <rebrand-wt> --apply \
  --expo-owner lbk-company --expo-project-id 9314cc2c-4abe-4637-b1cf-647fbbfbd807
node scripts/branding/apply.mjs --root <rebrand-wt>            # dry run, review
node scripts/branding/apply.mjs --root <rebrand-wt> --apply
(cd <rebrand-wt> && <main>/node_modules/.bin/oxfmt . && <main>/node_modules/.bin/oxlint)
git -c core.excludesFile=/dev/null -C <rebrand-wt> add -A
node scripts/rebrand-clisbot.mjs --root <rebrand-wt> --check \
  --expo-owner lbk-company --expo-project-id 9314cc2c-4abe-4637-b1cf-647fbbfbd807
```

- The rename script stops on upstream copy it does not recognize (README
  sections, landing-page blocks). Update the script and its test on `main` first,
  in their own commit, then rerun. Run `node --test scripts/rebrand-clisbot.test.mjs`.
- It also stops **after** moving files when Git ignores a destination. A
  machine-wide `plugins/` ignore hides `clisbot-plugin.json` files; staging with
  `core.excludesFile=/dev/null` covers that. Repository and `.git/info/exclude`
  rules still apply: add narrow exceptions, never `git add -f .`.
- Run the [file completeness gate](#file-completeness-gate) on the snapshot, scan
  the remaining `paseo` matches, then commit "Rebrand upstream vX.Y.Z for Clisbot
  sync".

### 2. Merge and classify against the normalized base

Git's merge base is a raw upstream commit, so every renamed line conflicts. Build
the same base renamed and formatted, and compare against that:

```bash
git worktree add -b sync/promotion-vX.Y.Z <merge-wt> main
git -C <merge-wt> -c merge.conflictStyle=zdiff3 merge --no-ff --no-commit sync/rebranded-vX.Y.Z
scripts/upstream-sync/normalized-base.sh "$(git -C <merge-wt> merge-base HEAD MERGE_HEAD)" <nbase-wt>
(cd <merge-wt> && python3 scripts/upstream-sync/resolve-conflicts.py --nbase <nbase-wt>)          # report
(cd <merge-wt> && python3 scripts/upstream-sync/resolve-conflicts.py --nbase <nbase-wt> --apply --json <log>)
```

`--apply` stages files where only one side differs from the normalized base and
files that merge cleanly three ways, and rewrites the rest with conflict markers
whose base arm is the normalized base (784 raw hunks became 238 for v0.11.1).
Archive the original conflict copies first if the audit needs them.

- **One-sided** files (upstream deleted, Clisbot edited): delete when Clisbot
  only renamed them (`diff` against the normalized base is empty); otherwise move
  the Clisbot edit to upstream's replacement.
- **Package manifests**: take upstream's version bumps, keep Clisbot's
  dependencies and scripts, and bump the Clisbot-only packages' pins on upstream
  packages (`device-access`, `hub`) too. Then
  `python3 scripts/upstream-sync/merge-lockfile.py --nbase <nbase-wt>` and
  `npm install --package-lock-only --ignore-scripts`.
- **Real overlaps**: keep both features. Upstream's structure wins; re-apply the
  Clisbot addition on top of it. Read upstream's commit for the reason
  (`git log c<base>..refs/upstream-releases/vX.Y.Z -- <raw path>`).
- When "both sides added" hunks sit at the end of a file or block, the shared
  closing line belongs to both: `a + "});\n" + c`, not `a + c`. Run
  `npm run format` as soon as the markers are gone; it reports these as parse
  errors.
- Subagents help with the hand-resolved files, but give each a disjoint file
  list and small batches: a parallel batch can hit the session rate limit and
  stop with nothing written.

### 3. Build, then typecheck

A fresh worktree typechecks against built output; without it you get thousands
of false errors.

```bash
npm ci && npm ls --workspaces --depth=0
npm run build:server && npm run build:channels && npm run build:app-deps
npm run typecheck && npm run lint && npm run format
```

Typecheck is where the real merge damage shows. Expect Clisbot code calling an
upstream API that changed without any text conflict:

- an export renamed or moved (`getProviderIcon` → `useProviderIcon`,
  `ui/menu/menu-anchor` → `ui/anchor`, `use-compact-time-ago` → `use-time-ago`);
- a type that gained required fields (panel manifests, `ForwardedAgentSession`,
  which also forwards every optional session member);
- an upstream replacement for a Clisbot helper that drops Clisbot fields: check
  [the seams](#seams-to-check-every-sync);
- new i18n keys missing from Clisbot-only locales (`vi.ts`, the `vi` block of
  `plugin-settings.ts`);
- new hand-styled inputs that need the light-theme tokens (`colors.input`,
  `colors.placeholder`, see [design.md](../../design.md)).

Lint must report the same files as `main` before the merge.

### 4. Check every Clisbot commit survived

```bash
python3 scripts/upstream-sync/clisbot-change-survival.py \
  --since <previous sync merge> --pre <main before> --post <merge-wt HEAD> \
  [--exclude <retired history ref>] --json <log>
```

It lists, per Clisbot commit, the lines it added that were present before the
merge and are missing after it. Classify each as an intended adaptation or a
loss. It catches what the normalized base cannot: where Clisbot kept upstream's
raw text, Git sees that side as unchanged and takes the renamed upstream line
with no conflict (this lost the hosted Hub origin in v0.11.1). Also compare
binary files and check that no file Clisbot deleted came back.

### 5. Test against a baseline

Run the tests for files touched by conflicts and fixes, then the Clisbot-owned
areas: app `src/clisbot`, device access, sidebar nav, hosts, i18n; server
connectors, chats, managed access, device access, network, bots, schedules,
session storage; Hub `src/daemons`, `src/channels`, the channel loader and
contract (`npm run test:loader:native`, `test:contract:native`), and
`npm run test:sim-boot`. Run vitest from the package directory. Never run a
whole workspace suite.

Hub tests need Docker. With Colima:

```bash
export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock \
  TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock TESTCONTAINERS_RYUK_DISABLED=true
```

Do not call a failure a regression until it passes on the pre-merge commit:
`git worktree add --detach <baseline-wt> <main before>`, `npm ci`, the same
builds, the same test file. In v0.11.1 every remaining failure (22) also failed
before the merge.

### 6. Run the app and look at it

```bash
npm run build:daemon-web-ui
CLISBOT_HOME=<tmp> CLISBOT_LISTEN=127.0.0.1:<port> CLISBOT_WEB_UI_ENABLED=true \
  CLISBOT_RELAY_ENABLED=false packages/cli/bin/clisbot daemon run &
node scripts/upstream-sync/web-tour.mjs --url http://127.0.0.1:<port> --out <dir>
```

Before the tour, run one real agent turn (`clisbot run --provider
codex/gpt-5.6-luna "Reply with exactly: OK"`), create a Bot in the UI and chat
with it, and add a schedule, so the screens have content. The tour covers home,
Connectors, Automations, settings (language, appearance, sidebar), Create bot,
Add connection, Vietnamese, Welcome, mobile and dark, and fails on any page
error. Run it against a baseline build too when something looks off. Leave
Usage out of saved screenshots: it shows account emails.

### 7. Record, commit, promote

- Write the merge audit next to the previous ones: inputs and SHAs, conflict
  counts and classification, decisions, integration fixes, survival result,
  test results with their baseline, screenshots, what was not run.
- Commit the merge from the merge worktree (its `node_modules` are current; the
  pre-commit hook typechecks). Fast-forward `main`:
  `git -C <main> merge --ff-only sync/promotion-vX.Y.Z`. If it refuses because
  `main` moved, reconcile first.
- After the user approves: push, tag `clisbot/sync-verified-YYYY-MM-DD-vX.Y.Z`
  ([tags](#tags)), remove the worktrees and the `sync/*` branches. The merge
  commit keeps both histories.
- The `main` checkout needs `npm install` afterwards; until then its hook
  typecheck fails on the new dependencies.

Other sessions may share the checkout. Check `git status` before and after you
touch it, discard only named paths (`git checkout -- <path>`, never `.`), and
leave staged work you did not make alone.

## File completeness gate

Run on the transformed snapshot and on the merged tree, before each commit
([2026-10-01 lesson](../../lessons/2026-10-01-rebrand-file-completeness.md)):

1. Compare the expected renamed paths with the Git index. A clean tree and a
   passing `--check` cannot see a renamed file that was never staged.
2. Explain every deletion. Expected ones: the archived upstream blog posts and
   runtime files Clisbot removed (`cli-client-id`).
3. Check imports, npm script paths, package exports, branding assets and
   symlinks.
4. Review staged paths for scratch output, runtime state, secrets and real
   identities.

## Seams to check every sync

Files both sides change. Git may merge them cleanly and still break them.

- **Sidebar footer**: upstream's footer rows (Usage, plugin rows) and Clisbot's
  bottom bar share `sidebarFooterItems`; `sidebar-nav/footer-model.ts` and
  `sidebar-nav/model.ts` each keep the other's keys; `left-sidebar.tsx` and
  `settings/sidebar/sidebar-nav-section.tsx` render both. Clisbot's header order
  is `builtinOrder` on upstream's section model.
- **Pairing**: `runtime/host-runtime.ts`, `pair-link-modal.tsx`,
  `hosts/pair-scan-model.ts`. Clisbot device and Hub links are handled before
  upstream's host confirmation; v5 offers are refused before it.
- **Server info**: `stores/session-store.ts` `toDaemonServerInfo` must carry
  `botCreationAllowed` and `permissions`, or Bot creation and managed access
  break after a reconnect.
- **Light theme**: `styles/theme.ts` (light values, `surfaceSidebarHover`,
  `input`, `inputBorder`, `placeholder`), `styles/settings.ts` (cards on
  `surface0`), `form-field.tsx`, `select-field.tsx`. Hand-styled inputs use
  `colors.input`; every `placeholderTextColor` uses `colors.placeholder`.
  Search, find, menu and read-only fields stay filled.
- **Cards**: sidebar empty states and the home cards use `settingsStyles.card`.
- **Providers**: `provider-registry.ts` (custom ACP providers pass
  `exactMcpPreapproval` to the client), `acp-agent.ts` (Clisbot's handshake
  timeouts and 1 s shutdown budget), OpenCode `event-consumer.ts` (Clisbot's
  first-record deadline).
- **Daemon client**: the pending-send queue keeps the message so an aborted
  request is removed.
- **Settings screen**: Clisbot's detail layout (Hub picker, wide content,
  `SettingsDetailContent`) instead of upstream's `PageLayout`.
- **Hub** (`getpaseo/hub`, merged into `packages/hub`):
  `daemons/registry.ts` (`sessionChannel`, `sessionAccess`,
  `subscribeDaemonSession`, and edits in the socket-close handler, inbound
  dispatch and `receiveRpcError`), `daemons/protocol.ts`, `app.ts` and
  `application-runtime.ts` (`COMPAT(clisbot-control-plane)` seams).

Add a seam here when a merge breaks it; remove one when the code moves into a
Clisbot-owned folder.

## Rename rules

[`scripts/rebrand-clisbot.mjs`](../../../scripts/rebrand-clisbot.mjs) applies
these to Git-tracked paths and UTF-8 text. They are string rules, not proof that
a remaining old name is valid. `--check` only proves another run changes
nothing. After each transform and each merge, scan tracked contents and paths
for `paseo` and classify each match as provenance, an intentional endpoint, or
work left.

| Input                                                                                                                                                                                               | Current rule                                                                                                                                                                                                                                                                                                                                                                                | Review when syncing                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/audits/**`; `docs/lessons/**`; `docs/overview/product-vision.md`; this playbook; the rename script, its test, `scripts/rebrand-templates/**`, `scripts/branding/**`, and `assets/branding/**` | Preserve the entire path and contents.                                                                                                                                                                                                                                                                                                                                                      | Historical and legal provenance can retain Paseo, but protection does not make every statement in these files current.                                                                                                                                                               |
| Root `LICENSE`                                                                                                                                                                                      | Prepend a scoped Clisbot copyright notice for Long Luong from `license-clisbot-notice.txt`; retain the complete upstream file verbatim below it. Skip general name replacement.                                                                                                                                                                                                             | Apache-2.0 terms and upstream notices remain intact. Review unfamiliar existing Clisbot notices before changing them. The README License rule also stops on unfamiliar upstream legal text.                                                                                          |
| `getpaseo/paseo-relay`                                                                                                                                                                              | Preserve this exact external repository identity.                                                                                                                                                                                                                                                                                                                                           | Confirm each reference still points to the upstream relay, rather than presenting it as a Clisbot-owned service.                                                                                                                                                                     |
| `getpaseo/paseo`, `@getpaseo/*`, other `getpaseo` text                                                                                                                                              | Rewrite the first to `longbkit/clisbot` and the package scope to `@clisbot/*`. The general lowercase replacement leaves `getpaseo` intact because it skips `paseo` immediately after `get`.                                                                                                                                                                                                 | This broad exception can retain unrelated GitHub identities and examples; review each remaining match.                                                                                                                                                                               |
| `app.paseo.sh`, `relay.paseo.sh`, `hub.paseo.sh` with `--keep-upstream-endpoints`                                                                                                                   | Preserve the live upstream service hosts, including escaped host patterns. Plain site and documentation links to `paseo.sh` become `clisbot.com`.                                                                                                                                                                                                                                           | Use this flag only on the isolated test branches. Without it, the hosts are transformed for Clisbot; confirm replacement services before cutover.                                                                                                                                    |
| `PASEO`, `Paseo`, `paseo` elsewhere                                                                                                                                                                 | Replace with `CLISBOT`, `Clisbot`, `clisbot` in text and paths; file-specific fixes remove collapsed aliases and set publishing/Expo ownership.                                                                                                                                                                                                                                             | The rule is case-sensitive and does not cover every mixed-case spelling or contextual claim. Review product copy and configuration after replacement.                                                                                                                                |
| Upstream hosted Hub (`hub.paseo.sh`): CLI default origin, `hub init` endpoint choice, Hub handoff command, website plans and CTAs, `public-docs/hub/hosted.md`                                      | Clisbot runs no hosted Hub. The CLI stops with `HUB_ORIGIN_REQUIRED` when no origin, `CLISBOT_HUB_URL` or stored login selects one; the website shows hosted plans only when `VITE_HUB_PLANS_URL` is set; the hosted docs page is deleted.                                                                                                                                                  | Upstream edits to these lines conflict (or arrive as modify/delete on `hosted.md`); keep the Clisbot side. Search the merged tree for `hub.paseo.sh` and `hub.clisbot.com` outside dated audits. `packages/hub/fly.toml` still names `hub.paseo.sh` and is not a Clisbot deployment. |
| Upstream Sponsor page, sponsor data, README sponsor sections, and `.github/FUNDING.yml`                                                                                                             | Replace the website files from version-controlled templates and the four README sponsor sections with neutral placeholders; clear GitHub funding options; send app Sponsor links to `clisbot.com/sponsor`.                                                                                                                                                                                  | Keep payment links and old maintainer claims out of the Clisbot UI. When Clisbot sponsorship is ready, update the templates and rule before the next sync.                                                                                                                           |
| Hub image references and release wiring                                                                                                                                                             | Use the shared `ghcr.io/longbkit/clisbot` image; Hub Compose selects `CLISBOT_RUN_MODE=hub`. The nested Hub workflow no longer publishes images.                                                                                                                                                                                                                                            | The root Docker workflow is the sole publisher; [service modes](../../docker.md#service-modes) own runtime selection.                                                                                                                                                                |
| Default service ports                                                                                                                                                                               | The contextual port transform maps daemon `6767` → `6868`, dev daemon `6768` → `6869`, and Hub defaults (`3000` / CLI `6868`) → `6870`.                                                                                                                                                                                                                                                     | Source fallbacks, app add-host defaults, SSH transport, Docker, Nix and current examples must agree. Preserve explicit user configuration and historical evidence. E2E guards block both Paseo and Clisbot ports. Do not replace unrelated `3000` timers or application examples.    |
| Website operator identity                                                                                                                                                                           | Use Long Luong / `clisbot@gmail.com`; remove inherited address/VAT from the identity component.                                                                                                                                                                                                                                                                                             | Upstream copyright remains intact. Governing law and operational promises still require publication review.                                                                                                                                                                          |
| Upstream testimonials and personal blog articles                                                                                                                                                    | Remove the known testimonial wall. Archive the two inherited articles under `packages/website/posts/upstream/`, restore their original product name and credit, exclude them from blog imports, and protect the archive from rename.                                                                                                                                                        | Stop on unknown testimonial markup. Review new upstream articles individually; see [publication review](../../audits/2026-09-30-clisbot-branding/publication-review.md).                                                                                                             |
| Upstream Discord invite and old X/Reddit badges                                                                                                                                                     | Rewrite the Discord invite to `https://discord.gg/awGmcmFXC`; remove the previous maintainer's X badge and the unclaimed Reddit badge.                                                                                                                                                                                                                                                      | Review new upstream community links individually; this rule covers the known old invite and badges, not every possible new URL.                                                                                                                                                      |
| Four README introductions, concept, author, license, and attribution sections                                                                                                                       | Replace the centered tagline and subtitle, opening description, and provider-choice bullet in each locale. Insert localized Concept, author story, and Attribution sections; place the author story after Concept. Replace the known README License summary with the Clisbot summary. Remove the inherited Related projects lists; preserve the Chinese relay TLS guide as its own section. | The deliberate `Paseo` names and `getpaseo/paseo` links in Concept and Attribution identify the source project. Update the copy in the script and templates together when messaging changes.                                                                                         |

External authors' repository, media and npm artifact identities stay verbatim.
Historical daemon compatibility tests install the actual published `@getpaseo/server`
versions and translate fixture environment variables to `PASEO_*`; those versions
were never published under `@clisbot/server`. Preserve these boundaries on each sync.

Repository URLs also match escaped slashes in regexes and `%2F` in encoded login
return URLs. `docker/relay/` is protected because its pinned Elixir release keeps
`PASEO_RELAY_*` names ([relay deployment](../../relay-deployment.md)).
`--keep-upstream-endpoints` keeps `app.paseo.sh` and `relay.paseo.sh`; use it only
on disposable reference branches, never on a promoted snapshot.

The README introductions come from `scripts/rebrand-templates/readme-*-intro.md`,
between `<!-- clisbot:intro:start -->` and `<!-- clisbot:intro:end -->`. "40+
agent options" counts the built-in providers in the
[provider manifest](../../../packages/protocol/src/provider-manifest.ts) and
plugins (7 at v0.11.1) plus the
[ACP catalog](../../../packages/app/src/data/acp-provider-catalog.ts) (38);
recount and update the four READMEs and the script when either changes.

Publication identity (operator text, attribution, authorship, testimonials,
store IDs, community links) is reviewed separately:
[publication review](../../audits/2026-09-30-clisbot-branding/publication-review.md).

## Visual branding

After the rename, `scripts/branding/apply.mjs` installs the versioned
[Flow / Ocean 02 kit](../../../assets/branding/clisbot/README.md) and updates
inline logo geometry and image configuration. It dry-runs by default; review,
`--apply`, then `--check`. Unknown logo geometry or a missing consumer stops it
before writing: update the transform first. Use the same kit bytes on both
sides; rebuild the kit only when the artwork changes. The manifest covers known
consumers, so look at image paths the release adds. Coverage baseline:
[branding audit](../../audits/2026-09-30-clisbot-branding/README.md).

## Tags

Both upstreams publish `v*` tags into the same namespace as our fork, and the
last fetch wins (on 2026-09-14 local `v0.8.0` named the Hub release). Run
`scripts/setup-git-remotes.sh` once per clone: it makes both upstreams
branches-only, so `refs/tags/` matches `origin`. Fetch upstream releases into
their own namespaces and verify the peeled commit:

```bash
git fetch --no-tags upstream     refs/tags/vX.Y.Z:refs/upstream-releases/vX.Y.Z
git fetch --no-tags hub-upstream refs/tags/vX.Y.Z:refs/hub-releases/vX.Y.Z
```

`clisbot/sync-verified-*` tags are ours: push them. Scratch markers stay local.

## Merge, not rebase

Sync merges: Clisbot commits keep their hashes, each shared file is resolved
once, `main` never needs a force-push, and the next sync merges only the delta.
Rebase is for small unshared branches, such as upstream PRs.

## Contributing back to upstream

1. In the fork clone, branch from `upstream/main`, never from Clisbot:
   `git fetch upstream && git checkout -b fix/<name> upstream/main`.
2. Write the fix fresh, or cherry-pick it from Clisbot.
3. Add a regression test that fails on the old code for the reported reason.
4. Rebase on `upstream/main` if it moved; run typecheck and targeted tests;
   `git push --force-with-lease origin fix/<name>`.
5. Open `longbkit/paseo:fix/<name>` → `getpaseo/paseo:main` with "Allow edits by
   maintainers" and the QA evidence from `CONTRIBUTING.md`.

Never merge Clisbot into an upstream PR; it drags in the whole channel plane.

## Release gate

A Clisbot release is a tag on `main` whose notes name the upstream release it is
based on. A merge commit is not a verified sync point: reproducible install,
typecheck, focused tests and the required live channel evidence come first.

## Keeping the merge path cheap

The goal is merging a release in a day with the channel plane intact.

- Keep Clisbot changes additive, in its own folders (`packages/hub`,
  `packages/channels/*`, `src/clisbot/*`, new CLI commands). Push a change into a
  Clisbot folder rather than an upstream file whenever both work.
- When you must edit an upstream file, keep the edit small and mark it, and
  extend upstream's structure rather than replacing it (`builtinOrder` rather
  than a second nav model).
- Measure overlap by upstream lines replaced, not lines added. `packages/hub`
  maps to the root of `getpaseo/hub`; `packages/channels/*/upstream-sync.json`
  carries per-file status. Worked example:
  [agent session storage: upstream blast radius](../../features/agent-session-storage/upstream-blast-radius.md).
- Treat a failing upstream test as a missing feature gate, not a stale assertion.

If Clisbot ever has to pin an old upstream release while backporting fixes,
make the fork a vendor base (that release plus a minimal backport set). It
doubles the diff layers; do not adopt it early.

## OpenClaw channel source manifests

The packages under `packages/channels/*` also
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

The 2026-09-07 one-week rehearsal of `apply` (120 files, zero conflicts on `verbatim`, about 50 hand-resolved `adapted` files) is in the [sync history](../../audits/2026-10-09-upstream-sync-history.md#openclaw-apply-rehearsal-2026-09-07).
