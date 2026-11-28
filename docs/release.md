# Release

All workspaces share one version and release together.

## Two steps

A release has exactly two steps. The agent does the first, the user authorizes the second.

**Preparation** (local, reversible — agent does this):

- format, lint, typecheck all green
- resolve the release source to one commit and confirm that commit's existing CI is green
- classify the diff from the previous stable to the release source as patch or minor, then show the
  target version and rationale to the user
- draft the changelog, show it to the user, wait for review
- run the pre-release sanity check, surface findings to the user

**Go-ahead** (user says "go ahead"):

- commit the approved release inputs locally
- run the release, which publishes npm and pushes the prepared branch and tag
- create the release heartbeat immediately and babysit it to completion

Rules that apply to both steps:

- Last-minute changes always need approval. Every time.
- No code changes bundled into the changelog commit or the release commit. Code shims live in their own commit, reviewed on their own merits.
- A sanity-check finding is information, not a directive. The agent surfaces it; the user decides.
- Invoking a release skill is intent to start the flow, not blanket authorization to publish.
- An approval the user already gave covers what it names, such as an explicit PR selection or authorization to release autonomously. Do not ask for it again.
- If the user asks for a release preview, show the prospective changelog/release contents and answer questions, but do not commit, tag, publish, or run release commands until they explicitly authorize the release.

## Release credentials

Each release step reads one credential. The originals live in the owner's private credentials
folder (`08.credentials/clisbot/`); never paste a value into chat, logs or Git.

| Step                                 | Credential                                                                                                                                                                   | Where it is read                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm publish (local)                  | `NPM_RELEASE_TOKEN`                                                                                                                                                          | The environment, else the checkout's `.env`. `scripts/npm-release.mjs` writes it to a temporary npmrc for the run, so a stale `~/.npmrc` login does not matter      |
| macOS signing (Desktop Release)      | `APPLE_CERTIFICATE` (base64 of the Developer ID `identity-keychain-compatible.p12`), `APPLE_CERTIFICATE_PASSWORD`                                                            | GitHub secrets                                                                                                                                                      |
| macOS notarization (Desktop Release) | `APPLE_API_KEY` (the App Store Connect `.p8` text), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`                                                                  | GitHub secrets; the workflow writes the key to a file for electron-builder. `APPLE_ID` + `APPLE_PASSWORD` are a fallback only                                       |
| Android APK (Android APK Release)    | `EXPO_TOKEN` (token of the `github-release` robot on the Expo account `clisbot-team`, which owns the project), `GOOGLE_SERVICES_JSON_PROD`, `GOOGLE_SERVICE_INFO_PLIST_PROD` | GitHub secrets. The APK is built on the runner with `eas build --local`: `production-apk` needs the paid `large` cloud class. EAS still serves the signing keystore |
| iOS and Google Play                  | Apple distribution certificate, App Store Connect key, Play account                                                                                                          | The App Store operator agent, which asks the owner before each outward-facing step                                                                                  |

A missing Apple secret builds unsigned macOS artifacts with a warning; a missing Firebase secret
builds an APK without product analytics. Check `gh secret list` before tagging.

## Release source and CI

The default release source is `origin/main`. Fetch `origin`, then record the
resolved commit. The default release checkout is a clean local `main` whose
`HEAD` equals `origin/main`.

An explicit user instruction can select another ref, such as a hotfix commit or
tag. Resolve that ref once and apply every source, diff, and CI check to that
commit instead of `origin/main`.

Before making release-preparation commits, confirm the existing CI run for the
resolved commit is green. Pending CI is watched to completion. Release
preparation then stays local through the changelog, any explicitly requested ACP
catalog update, lockfile preparation, and the version commit. After approval,
commit the prepared inputs locally and run the release command. Its branch and
tag push is the one remote release batch and starts CI for the complete release
commit.

## Release branch discipline

While you finalize a release on `main`, use a temporary `next` branch for work intended for the following
release. This applies to both beta and stable releases.

- Create each new `next` from freshly fetched `origin/main`. Reuse it while active.
- "This goes to next" means create the PR against `next` or retarget an existing
  PR, and keep that destination through delivery.
- Keep `next` current by merging `origin/main` into it as release fixes land.
  Avoid rebasing this shared branch because agents and open PRs depend on its history.
- After the release ships, bring `next` up to date and open a `next` → `main` PR.
  Pass CI and merge without squashing away the individual PR commits needed for
  the changelog. Retarget remaining PRs based on `next` to `main` and delete the integrated
  `next`. Create it fresh when needed again.

**Setup still needed:** PR checks run for every base branch, but CI, Docker, and Nix
push runs target only `main`, and GitHub permits only squash merges. Enable
required-check protection for `next`, CI on its pushes, and merge commits for the
integration PR. Handle PR
base changes (`edited` events) so retargeting runs checks against the new base;
GitHub's default PR events do not cover this. Deployment triggers stay unchanged.

### Hotfix from a release tag

If `main` contains changes you do not want to release, branch from the affected
release tag and cherry-pick only the required fixes. Run CI on that branch, then
use the normal release flow with it as the explicit source, choosing a new patch
or beta version. Ensure the fixes and changelog also reach `main` and any active
`next`, preserving newer development and version changes there. This is a
short-lived hotfix branch, not another maintained release track.

## ACP catalog updates

ACP catalog work enters a release through an explicit user request:

- **Check ACP drift** — run `npm run acp:version-drift:check`. When drift exists,
  run `npm run acp:version-drift:update`, verify the catalog, and include the
  update in the local release-preparation commits.
- **Update ACP** — run `npm run acp:version-drift:update`, verify the catalog, and
  include the update in the local release-preparation commits.

The release authorization covers the requested ACP commit. It ships in the same
release push as the changelog and version commit.

## Two paths

There are two supported release paths:

1. **Direct stable release**: you are ready to ship the resolved release source to everyone immediately (default `origin/main`).
2. **Beta flow**: release candidates on the `beta` channel. Each beta folds into the series' single changelog entry, publishes npm only on the explicit `beta` dist-tag, and stays behind the Stable/Beta switch on `/download`.

Clisbot has one linear release track even though npm dist-tags are independent
pointers. The npm invariant is:

- A beta release moves only `beta`; `latest` remains on the newest stable.
- A stable release moves both `latest` and `beta` to that stable version. This
  keeps users who install `clisbot@beta` on the newest Clisbot release after
  a beta is promoted or superseded by a direct stable release.

## Release version decision

Every fresh release starts by classifying the full diff from the previous
stable to the resolved release source. The highest-impact change determines the
version:

- **Minor** — a user would experience the release as a significant upgrade. This
  includes substantial new workflows, providers, forges, platforms, integrations,
  or meaningful expansions of existing capabilities. Foundational internal work
  also qualifies when it materially changes reliability, performance,
  compatibility, deployment, or operation; diff size alone does not.
- **Patch** — fixes, polish, small enhancements, and reliability or performance
  improvements within existing capabilities. Follow-up corrections to a minor
  release are patches.

The release agent selects patch or minor during preparation and presents the
target version with the changelog for approval. Agents never select a major
version autonomously. A major release requires an explicit user instruction and
approval. The user selected `2.0.0` for the architectural replacement of legacy
Clisbot `0.1.x`; subsequent Clisbot versions follow their own release track.

Version bumps are never used to retry a failed build. Retry the existing version
as described in **Fixing a failed release build**.

### Clisbot 2 and the Paseo baseline

`clisbot` remains the public npm entry for existing users. It is a small wrapper
around `@clisbot/cli`; users install one package while npm installs its runtime
dependencies. All public Clisbot runtime workspaces share the same exact version.
`node scripts/npm-release.mjs list` lists the dependency-first publication graph.
The wrapper publishes last so `clisbot@latest` never advertises missing internal
packages. `expo-two-way-audio` is outside that graph and is built with the mobile
app; do not publish it just because its workspace version changes.

For the first major release, set the approved destination explicitly:

```bash
npm run version:all:set -- --version 2.0.0
```

Do not use `release:major` to select an arbitrary destination: it only increments
the current major. Once the tree already contains `2.0.0`, use the manual flow
below without another version bump. The stable publisher moves both `latest`
and `beta` for every package in the graph; beta publication moves only `beta`.
It skips an existing package version and resumes dependency-first publication.
Never edit the contents of an already published version during a retry.

`upstream-baseline.json` records the Paseo repository, tag and full source commit.
This is provenance, not the Clisbot product version. After each upstream merge,
update the baseline from the actual merged commit, keep Clisbot versions intact,
and check exact internal runtime dependencies with the npm graph command. Mention
the baseline in the Clisbot changelog. A Paseo version bump must not reset the
Clisbot release version.

The upgrade contract for legacy npm users is documented in
[Upgrade to v2](guides/user-guide/getting-started/upgrade-v2.md). A successful
fresh install of the real packed npm graph must exercise the legacy home,
Project registration, pairing, shared app UI, local Hub backend and auth cookies using
`node scripts/npm-installed-smoke.mjs` before publication.
Run this consumer check with npm 10 and npm 11 on supported Node versions; the
source build and Docker may pin their own installer independently.

Hub bundles Better Auth, its OAuth provider and their installed production dependencies. Its optional
framework/test peer graph crashes npm 10's resolver before lifecycle scripts can
run ([upstream fix](https://github.com/npm/cli/pull/8448)). The Hub build stages the
locked, installed modules locally because npm pack cannot bundle workspace-hoisted
files. Staged manifests omit optional peers outside the bundle: npm otherwise
marks those peers bundled and leaves empty directories when Hub is a global root.
Each changed manifest ships its exact original as `package.json.upstream`; runtime
files and licenses remain unchanged. Required peers must resolve within the bundle.
Keep TanStack Start
as a runtime dependency: Better Auth's cookie hook dynamically imports its server
entry. The installed smoke rejects a missing bundle and exercises that hook plus
password failure/retry, and imports the installed Hub SSR build. Also run the
Docker Hub smoke with Hub installed as a global root, with channels enabled and
disabled; a CLI-only root can hoist peers above Hub and hide a broken bundle.
Do not replace these checks with a successful dry run or
an installation using checkout symlinks. See the
[installation boundary audit](audits/2026-10-17-npm-install/README.md).

## Standard release (stable)

Before running any stable release command:

- Make sure the resolved release source passed CI, the approved release inputs are committed locally on the intended branch, and the working tree is clean.
- **Run `npm run format`, `npm run lint`, and `npm run typecheck` and commit any resulting changes BEFORE you start any `release:*` command.** `release:check` runs `npm install --workspaces --include-workspace-root` as part of `release:prepare`, which can mutate `package-lock.json` (e.g. churning `"dev": true` markers on optional deps). The next step, `version:all:*`, runs `npm version` which aborts when the working tree is dirty. If this happens mid-flight you have to commit the lockfile churn before retrying — and the pre-commit format hook will reject a lockfile-only commit because oxfmt internally skips `package-lock.json` while lefthook's glob still matches it. Avoid the whole mess by running format/lint/typecheck first, then `release:prepare` once on its own to absorb any lockfile churn into a normal commit, then start the release.
- Do not use a release command as a substitute for checking whether the current commit is actually ready.

```bash
# Run exactly one, matching the approved decision:
npm run release:patch
npm run release:minor
```

This bumps the version across all workspaces, runs checks, publishes to npm, and pushes the branch + tag. The tag push triggers `Desktop Release`, `Android APK Release`, `Docker`, and `Release Notes Sync` on GitHub Actions. The workflows create the GitHub Release as a draft while builds and release-note sync run. EAS picks up the same tag via the EAS GitHub app and starts the iOS + Android store builds in parallel (see "Mobile builds (EAS)" below) — there is no mobile-release workflow under `.github/workflows`.

The stable publisher sets both npm dist-tags for every package in the release
graph. Verify every package's `latest` and `beta` resolves to the release version
before considering npm complete; the public entry is `clisbot`.

The Docker workflow builds images from the checked-out source tree on pull requests and on `main` as non-publishing checks. Stable `vX.Y.Z` tag pushes publish `ghcr.io/longbkit/clisbot:X.Y.Z` and `ghcr.io/longbkit/clisbot:latest`; beta `vX.Y.Z-beta.N` tag pushes publish only `ghcr.io/longbkit/clisbot:X.Y.Z-beta.N` and never move `latest`.

The official production relay at `relay.clisbot.com` currently runs the Elixir service from [getpaseo/paseo-relay](https://github.com/getpaseo/paseo-relay). Its pinned Docker build and Cloudflare Tunnel service are versioned in `docker/relay/`; follow [relay deployment](relay-deployment.md) to update it separately. Clisbot releases and pushes to this repository do not deploy the relay server. `deploy-relay.yml` provides the manual Cloudflare Worker deployment option as `clisbot-relay-worker`, either running the Worker relay or proxying to an upstream origin such as Fly.

**Stable means stable.** If the user says "stable" or "ship stable", do not ask whether they want a beta first. They picked stable; treat it as a direct stable release. Only run the beta flow when the user explicitly says "beta".

## Manual step-by-step

```bash
npm run typecheck            # Verify the exact commit you intend to release
npm run release:check        # Typecheck, build, dry-run pack
# Set or bump the approved destination once (skip if already set):
npm run version:all:set -- --version 2.0.0
# Future releases normally use version:all:patch or version:all:minor.
npm run release:publish      # Publish to npm
npm run release:push         # Push HEAD + tag (triggers CI workflows)
# The stable publisher also moves beta for the entire package graph.
```

## Beta flow

```bash
npm run release:beta:patch       # Start the next patch beta line
npm run release:beta:minor       # Start the next minor beta line
# ... test desktop and APK prerelease assets from GitHub Releases ...
npm run release:beta:next        # Optional: cut X.Y.Z-beta.2, beta.3, ...
npm run release:promote          # Promote X.Y.Z-beta.N to stable X.Y.Z
```

- Beta tags are published GitHub prereleases like `v0.1.41-beta.1`
- Betas publish npm packages with `--tag beta`, so `npm install -g clisbot@beta` opts in while plain `npm install -g clisbot` stays on `latest`
- Betas publish desktop assets and APKs for testing. They also build iOS, upload it to TestFlight, add it to the `Clisbot Beta` external group, and submit it for Beta App Review. They do not submit mobile builds to the production stores.
- `release:promote` creates a fresh stable tag like `v0.1.41`; the final release never reuses the beta tag
- Desktop assets now come from the Electron package at `packages/desktop`
- Require the Linux artifact CI checks with both restricted and usable user namespaces to pass before publication; see [packaged desktop smoke](testing.md#packaged-desktop-smoke). Keep the installed-package and AppImage checks together.
- Beta releases use Electron's `beta` update channel. Users on the stable channel only receive stable releases; users on the beta channel receive beta releases and the final stable release when it is published.
- **A beta series has one changelog entry.** Each beta folds into it and renames its heading to the new `## X.Y.Z-beta.N`, which `Release Notes Sync` mirrors into that prerelease body. Promotion renames it to the stable heading. See the Changelog policy section.

Use the beta path when you need to:

- smoke a build yourself before promoting it to everyone
- test a build manually in a Linux or Windows VM
- send a build to a user who is hitting a specific problem
- iterate on `beta.1`, `beta.2`, `beta.3`, and so on before deciding to ship broadly

## Staged rollout (stable channel)

Stable desktop releases go out via a linear time-based rollout for automatic update checks: 0% admitted when the updater manifests appear, 100% admitted 36 hours later, linear ramp in between. Manual checks bypass the rollout so a user can install immediately when they click **Check**. Beta releases bypass the rollout entirely — beta users always receive updates immediately.

The rollout is driven by a `rolloutHours` field stamped into the GitHub Release manifests (`latest-mac.yml`, `latest-linux.yml`, `latest.yml`) by the `finalize-rollout` job in `desktop-release.yml`.

Desktop release builds now publish in two phases:

- The GitHub Release stays a draft while platform build jobs upload the installers/packages (`.dmg`, `.zip`, `.exe`, `.AppImage`, etc.).
- The final job merges and stamps every channel manifest, uploads them with the final `releaseDate` and `rolloutHours`, then publishes the GitHub Release.

Drafts do not appear in GitHub's releases feed. Updater clients continue to see the previous complete release until all three manifests are available. If a desktop build or manifest upload fails, the new release stays a draft.

### Default behavior

`npm run release:patch` or `npm run release:minor` → tag push → 36h ramp. No extra action needed.

The `rollout_hours` input on `desktop-release.yml` is **only read on `workflow_dispatch`** — tag-push runs always default to 36. To get any other rollout duration on a fresh release, use the post-publish flip below.

### Instant-admit release (rollout_hours=0)

Tag-push runs from `npm run release:patch` or `npm run release:minor` always stamp 36 hours. To admit everyone immediately (hotfix, doc-only change, a release you want out fast), cut the release normally, wait for it to publish, then flip the manifests:

```bash
# 1. Cut and publish (36h ramp from tag push).
npm run release:patch

# 2. Wait for Desktop Release to publish the GitHub Release.
gh run watch <desktop-release-run-id> --exit-status

# 3. Flip the published manifests to instant admit.
gh workflow run desktop-rollout.yml \
  -f tag=v0.1.64 \
  -f rollout_hours=0
```

Dispatch only after `finalize-rollout` has published the release. Until then the release is a draft, and a draft has no tag: `desktop-rollout.yml` looks the release up by tag and fails with `release not found`. The concurrency group `desktop-rollout-<tag>` that the two workflows share orders them only once both are queued; it does not hold an early dispatch until the draft is published.

The first public manifests carry `rolloutHours=36` for the minutes between publish and the flip. The renderer polls every 30 minutes, so active stable users pick up the new manifest on their next check.

### Adjusting an already-published release

To change the rollout duration on a release that's already shipped — e.g. flip a hotfix to instant admit, or slow a release down — use the dedicated `desktop-rollout.yml` workflow. It edits the manifests in place on the GitHub release without rebuilding anything. It only rewrites `rolloutHours`; `releaseDate` is preserved, so the rollout clock keeps ticking from the original publish time.

**Hotfix (instant admit) on an already-shipped release:**

```bash
gh workflow run desktop-rollout.yml \
  -f tag=v0.1.42 \
  -f rollout_hours=0
```

`rollout_hours=0` admits 100% of stable users on their next update check (within ~30 min for active clients).

**Slow a rollout down** (e.g. extend total duration to 72h since the original release):

```bash
gh workflow run desktop-rollout.yml \
  -f tag=v0.1.42 \
  -f rollout_hours=72
```

`rollout_hours` is **total duration since the original release date**, not "extend by N more hours from now." If `v0.1.42` was published 2h ago and you set `rollout_hours=72`, the ramp finishes 70h from now.

The dispatch is idempotent and shares the `desktop-rollout-<tag>` concurrency group with `desktop-release.yml`'s `finalize-rollout` job, so it serializes safely against an in-flight tag-push pipeline targeting the same release.

### Custom ramp on a manually-dispatched build

`desktop-release.yml` accepts `rollout_hours` only on `workflow_dispatch`, which is the path used to **rebuild an existing tag** (retry a failed release, force a rebuild on a different ref). When you go that route, you can stamp a non-default ramp directly:

```bash
gh workflow run desktop-release.yml \
  -f tag=v0.1.43 \
  -f rollout_hours=6
```

This does **not** apply to fresh releases cut via `npm run release:patch` or `npm run release:minor` — those paths always tag-push and stamp 36. For a fresh release with a custom ramp, cut normally and then dispatch `desktop-rollout.yml` (same pattern as the instant-admit flow above, with your chosen `rollout_hours`).

### Releasing during an active rollout

If you ship N+1 while N is still ramping, N+1 starts a fresh rollout from its own publish timestamp. N's rollout effectively ends — the newer manifest supersedes it. Rollout-aware clients revalidate the manifest for up to five seconds before installing a downloaded update on quit. If N+1 has replaced N but the client is not admitted to N+1 yet, it skips the downloaded N and waits rather than installing two updates in succession. If revalidation times out, the app exits without installing the cached update.

If N+1 is a hotfix for a bug in N, dispatch `desktop-rollout.yml -f tag=v0.1.<N+1> -f rollout_hours=0` after N+1 publishes so the users who already got N reach the fix fast.

### macOS system floor

The desktop app requires macOS 13 or newer. Keep both release guards when the floor changes:

- `packages/desktop/electron-builder.yml` writes the macOS version to `LSMinimumSystemVersion` for new installs.
- `scripts/merge-mac-manifest.mjs` writes the matching Darwin kernel version to `minimumSystemVersion` in the update manifest. Existing clients check this before downloading an update.

macOS 13 maps to Darwin 22. The two values use different version domains; do not copy the macOS version into the update manifest.

### Limitations

- **No pause / kill switch.** To stop new admissions, ship a superseding release. Clients revalidate on quit and will not install the superseded download, but a client that already completed installation cannot be recalled; ship a hotfix `+1` patch.
- **No rollback.** `allowDowngrade = false`. Bad release = ship a hotfix.
- **Bootstrap caveat.** Clients running a build older than the rollout feature ignore `rolloutHours` and admit immediately. Rollout protection only applies to clients running the rollout-aware version or later.
- **Up to ~30 min automatic admission latency.** Renderer polls every 30 minutes, so a stable user may take up to that long to be evaluated against the rollout window. Clicking **Check** is manual and bypasses rollout admission.

## Mobile builds (EAS)

iOS and Android store builds are not in `.github/workflows`. They are triggered by the EAS GitHub app the moment the `v*` tag is pushed:

- **Android (Play Store)** — EAS builds with profile `production` and auto-submits to the Play Store via `eas submit` (EAS-managed credentials). A Fastlane lane then replaces the store screenshots.
- **iOS (TestFlight + App Store)** — EAS builds with profile `production`, uploads once through a `testflight` job, distributes the build to the `Clisbot Beta` external group with Beta App Review submission, and a Fastlane lane uploads the store screenshots and submits that same build for App Store review.
- **Android APK (GitHub Release asset)** — separate, via `.github/workflows/android-apk-release.yml`. This is the only Android-related workflow that lives in this repo.

EAS uses the local app version source. `packages/app/app.config.js` derives the native version from the package version. Android `versionCode` is `major * 1_000_000 + minor * 1_000 + patch`. iOS reserves 1,000 build slots per app version: beta `N` uses slot `N`, and stable uses slot `999`. For example, `0.2.6-beta.2` appears in App Store Connect as version `0.2.6` build `2006002`; stable uses build `2006999`. Rebuilding the same tag produces the same native build number; if a store has already accepted a binary and you need a different binary, cut the next beta or patch instead of relying on EAS remote auto-increment.

Stable tags run `Release Mobile`; beta tags run `Release iOS Beta`. Both distribute to the persistent `Clisbot Beta` external group and submit for Beta App Review, so testers receive stable releases as well as betas. Testers, the group, and required TestFlight test information are managed once in App Store Connect.

Stable iOS releases use one binary for two Apple review paths: Beta App Review for external TestFlight distribution and App Store review. [Apple says](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers) the first submitted build requires a full TestFlight review; later builds for the same version might not. Do not assume a stable patch skips review.

There is no mobile-release workflow under `.github/workflows`. The EAS GitHub app reads the workflows under `packages/app/.eas/workflows` and handles tag triggering directly.

### Store screenshots

Each stable release publishes the screenshots committed under `assets/store-screenshots/output/` (see [its README](../assets/store-screenshots/README.md) for how they are made). To change the store screenshots, re-render and commit them before you tag.

- **App Store:** `submit_review` uploads `output/apple/` and `output/apple-ipad/` to the version it submits, replacing that version's `en-US` screenshots. Apple ties screenshots to an app version, so a version that is already live keeps the ones it shipped with. `Resubmit iOS for App Store review` uploads them again.
  - When `submit_review` fails with `appStoreVersions … is not in valid state`, the reason is in the API error's `meta.associatedErrors`, which fastlane does not print. Read it with a `POST /v1/reviewSubmissionItems` against the version. A required age-rating question that Apple added, such as `socialMedia`, fails this way; answer it under App Information > Age Rating in App Store Connect, then resubmit.
- **Google Play:** `upload_android_screenshots` runs `fastlane android upload_screenshots` after `submit_android`. It replaces only the `en-US` phone and 10-inch tablet screenshots, never the listing text or changelogs, and skips images whose checksum already matches. The lane stages only `en-US`: supply uploads every locale folder in one edit, and Play rejects F-Droid locales such as `ja`, which fails the whole edit. `Upload Google Play screenshots` reruns the step for the current release without a rebuild.
- **F-Droid:** reads the same files as Google Play. `fastlane/metadata/android/en-US/images/phoneScreenshots/` and `tenInchScreenshots/` hold symlinks to the Google renders. `render.mjs` rewrites them on every render, so added or renamed panels reach Google Play and F-Droid as well.

Fastlane cannot use the Play key Expo stores for `eas submit`. The Play lane reads its own copy of the same service-account key from the `GOOGLE_PLAY_JSON_KEY` file secret in the EAS `production` environment, and that service account needs the Play Console permission **Manage store presence**.

### Watching mobile builds from the terminal

Use the EAS CLI from `packages/app/`:

```bash
cd packages/app

# Recent builds (newest first). Pipe to jq for status only.
npx eas build:list --limit 8 --non-interactive --json | jq '.[] | {platform, status, appVersion, gitCommitHash}'

# Recent EAS workflow runs. This is the source of truth for submit/review jobs.
npx eas workflow:runs --json | jq '.[] | {status, workflowName, trigger, gitCommitHash, startedAt, finishedAt}'

# Filter by platform.
npx eas build:list --platform ios --limit 5 --non-interactive --json
npx eas build:list --platform android --limit 5 --non-interactive --json

# Inspect a specific build.
npx eas build:view <build-id>

# Inspect the full release workflow, including distribute_ios, submit_android,
# and submit_ios_for_review.
npx eas workflow:view <workflow-run-id> --json

# Read failed submit/review job logs.
npx eas workflow:logs <workflow-job-id> --all-steps --non-interactive

# Stream logs for a build.
npx eas build:view <build-id> --json | jq '.logFiles[]'
```

A build's `gitCommitHash` must match the release tag commit. `status` walks through `NEW` → `IN_QUEUE` → `IN_PROGRESS` → `FINISHED` (or `ERRORED`/`CANCELED`). The EAS workflow run's `gitCommitHash` and `trigger` must also match the release tag.

Once a build is `FINISHED`, EAS still has release-critical work to do: Android must submit to the Play Store, and iOS must distribute to the external TestFlight group with Beta App Review submission **and** submit the same build for App Store review. The release is not done until all platforms are on their way through the stores.

For the `Release Mobile` EAS workflow, these jobs must pass:

- `build_ios` — iOS binary built
- `distribute_ios` — iOS binary uploaded once, added to `Clisbot Beta`, and submitted for Beta App Review
- `submit_ios_for_review` — iOS build submitted for App Store review via Fastlane
- `build_android` — Android store binary built
- `submit_android` — Android binary submitted to the Play Store
- `upload_android_screenshots` — Google Play screenshots replaced from the repo

Do not treat `build_ios: SUCCESS` or `distribute_ios: SUCCESS` as a completed iOS release. `submit_ios_for_review: FAILURE` means the iOS release is blocked even if the build is visible in TestFlight.

To confirm the submission landed, inspect the EAS workflow with `npx eas workflow:view <workflow-run-id> --json`. App Store Connect (review state for the matching version/build) and the Play Console track are the final ground truth.

## Release completion and heartbeat

A release is **in progress** after npm publication and tag push. Report it as
**shipped** only after every applicable build, publication, asset, manifest, and
store submission passes the completion checklist.

Immediately after every beta, stable, or promotion tag push, create a heartbeat
that resumes the release in the current conversation. Create it automatically
with `create_heartbeat`. The heartbeat owns the release until it either reaches
the completion checklist or finds a failure that needs new user authority.

Each heartbeat checks the release tag commit, all GitHub Actions runs for the
release branch and tag, npm dist-tags, the GitHub Release body and assets,
desktop updater manifests, the published Docker image, and the applicable EAS
workflow. Inspect the GitHub Release itself and confirm that the macOS, Linux,
Windows, and Android APK assets are present along with the channel manifests
(`latest-mac.yml`, `latest-linux.yml`, and `latest.yml` for stable;
`beta-mac.yml`, `beta-linux.yml`, and `beta.yml` for beta).

For stable releases, also confirm every required mobile build, external
TestFlight distribution, Beta App Review submission, and store submission job
for the release commit. For betas, confirm
the beta EAS workflow completed its TestFlight distribution and Beta App Review
path. Delete the heartbeat only after every applicable checklist item passes,
then report the release as shipped.

Pattern:

```jsonc
// mcp__clisbot__create_heartbeat arguments
{
  "name": "vX.Y.Z release babysit heartbeat",
  "cron": "*/10 * * * *",
  "timezone": "UTC",
  "maxRuns": 120,
  "expiresIn": "24h",
  "prompt": "Resume the vX.Y.Z release babysit for commit <sha>. Check npm tags; every GitHub Actions run for the release branch and tag; the published GitHub Release body, expected desktop/APK assets, and channel manifests; the Docker image; and the matching EAS workflow. Completion requires every applicable checklist item. For stable, require build_ios, distribute_ios (Clisbot Beta external distribution and Beta App Review submission), submit_ios_for_review, build_android, and submit_android to succeed. For beta, require the beta TestFlight distribution and Beta App Review path. If work is pending, wait for the next heartbeat. If a failure can be retried safely for the same version, follow the failed-release procedure; otherwise report the blocker. When every applicable completion-checklist item passes, delete THIS heartbeat, report shipped, and stop.",
}
```

Run an immediate status check after creating the heartbeat. The heartbeat handles
later transitions and stops itself when the release is complete.

## Release notes on GitHub

The GitHub Release body is populated automatically by the `Release Notes Sync` workflow (`.github/workflows/release-notes-sync.yml`). It triggers on every `v*` tag push and on any push to `main` that touches `CHANGELOG.md`, then runs `scripts/sync-release-notes-from-changelog.mjs` to mirror the matching changelog entry into the release body. You don't need to write release notes on GitHub manually — keep `CHANGELOG.md` correct and the workflow will sync it. To force a re-sync, dispatch the workflow with the tag input.

## Website behavior

- Website cache freshness, install counter migration, and rollback requirements are maintained in [website cache and install counts](guides/developer-guide/website-cache.md). Deploy its SQLite Durable Object binding and exported class together.
- Release metadata and GitHub stars are optional for rendering the website. If no ready Clisbot desktop release exists or the GitHub lookup fails, the homepage links to `/download`, which shows links to the setup guide and GitHub releases instead of constructing download URLs for missing assets.
- The website download page defaults to GitHub's latest published **stable** release.
- A published beta prerelease is offered behind the Stable/Beta switch on `/download` (`?channel=beta`), never as the default. The switch only appears while the newest prerelease leads stable on its core version, so promoting `X.Y.Z-beta.N` to `X.Y.Z` retires the beta channel from the page until the next beta line opens.
- Homebrew, the Play Store, the App Store, and `app.clisbot.com` have no beta. The Beta view drops those rows, and the whole Web section, rather than showing an inert "stable only" placeholder. When a surface gains a beta path — say a public TestFlight link — add its row back in `packages/website/src/routes/{-$locale}/download.tsx`.
- The default download target only moves when you publish the final stable release tag like `v0.1.41`.
- The public `/changelog` page renders `CHANGELOG.md` as-is, so the in-flight `-beta.N` entry shows there once it lands on `main` — that's intended, it's where beta users check what's coming. Only the **default download target** stays pinned to the latest stable; the download links read GitHub's releases API, not the changelog, so a `-beta.N` heading on top never affects them.
- The download page's "What's new" link deep-links the **minor group** anchor (`/changelog#release-0.3`), not the exact entry: the beta entry is renamed on each beta and on promotion, so the minor group remains the durable target. A version with no entry in the bundled changelog — a tag whose changelog commit hasn't redeployed the site yet — links the plain `/changelog` instead of a dead anchor.
- Cloudflare rejects any uncompressed asset over 25 MiB, and the single-bundle web export passed that at v2.2.0. `Deploy App` exports with `CLISBOT_WEB_UTF8_EXPORT=1` (multilingual strings stay UTF-8 instead of `\u` escapes) and `CLISBOT_WEB_SPLIT_ROUTES=1` (`asyncRoutes` in `packages/app/app.config.js`: Expo Router loads each route's code on first visit, and the largest asset drops to about 16 MiB). Set both flags for a local deployment export. Native, Desktop and the daemon-served web UI export without them and keep one bundle. When the largest asset in `dist/_expo/static/js/web` nears 25 MiB again, look for a heavy dependency in `__common-*.js` before raising anything.
- The website itself is deployed by `Deploy Website` (Cloudflare Workers), which redeploys on the `release: published` event emitted when a stable draft is published and on pushes to `main` that touch `CHANGELOG.md` or `packages/website/**`. Its job condition excludes beta prereleases.

## Fixing a failed release build

**NEVER bump the version to fix a build problem.** New versions are reserved for meaningful product changes (features, fixes, improvements). Build/CI failures are fixed on the current version.

**Do not rely on `workflow_dispatch` for tagged code fixes.** The `workflow_dispatch` trigger runs the workflow file from the default branch but checks out the code at the tag ref (`ref: ${{ inputs.tag }}`). That means fixes committed to `main` won't change the tagged source tree being built. `workflow_dispatch` only helps when the fix lives in the workflow file itself.

For Docker-only retries, **do not push or force-push a `v*` release tag**.
`v*` tag pushes rebuild desktop assets, the Android APK, Docker, release notes,
and EAS mobile release builds. Use the Docker workflow dispatch instead:

```bash
gh workflow run docker.yml \
  --ref main \
  -f clisbot_version=X.Y.Z-beta.N \
  -f publish=true
```

This replaces `ghcr.io/longbkit/clisbot:X.Y.Z-beta.N` in place without touching
desktop, APK, or EAS release builders. The Docker exception is safe because the
dispatch runs from `--ref main` and uses the explicit `clisbot_version`; it does
not check out or move the `v*` release tag.

To retry a failed non-Docker release workflow, push a retry tag on the commit
you want to build. Reusing the same tag name is expected: move it with
`git tag -f ...` and push it with `--force` so the workflow rebuilds the commit
you actually want.

A failed desktop build leaves the GitHub Release as a draft. `finalize-rollout`
uploads manifests from successful platforms before it fails. A later
single-platform retry reuses those manifests, stamps the complete set with one
release date, and publishes the draft. Use `desktop-vX.Y.Z` when more than one
platform failed. A `workflow_dispatch` rebuild with publishing enabled follows
the same path against the existing draft.

Prefer a tag push over `workflow_dispatch` when rebuilding desktop or APK
release assets. Prefer Docker workflow dispatch when rebuilding only the Docker
image.

The retry tag patterns below still work and remain the supported way to rebuild specific release targets:

```bash
# Desktop (all platforms)
git tag -f desktop-v0.1.28 HEAD && git push origin desktop-v0.1.28 --force

# Desktop (single platform)
git tag -f desktop-macos-v0.1.28 HEAD && git push origin desktop-macos-v0.1.28 --force
git tag -f desktop-linux-v0.1.28 HEAD && git push origin desktop-linux-v0.1.28 --force
git tag -f desktop-windows-v0.1.28 HEAD && git push origin desktop-windows-v0.1.28 --force

# Android APK
git tag -f android-v0.1.28 HEAD && git push origin android-v0.1.28 --force

# Beta
git tag -f v0.1.29-beta.2 HEAD && git push origin v0.1.29-beta.2 --force
```

This ensures the checkout ref matches the code you want built, with the fix included.

- `vX.Y.Z` or `vX.Y.Z-beta.N` rebuilds the full tagged release
- `desktop-vX.Y.Z` rebuilds desktop for all desktop platforms only
- `desktop-macos-vX.Y.Z`, `desktop-linux-vX.Y.Z`, and `desktop-windows-vX.Y.Z` rebuild only that desktop platform
- `android-vX.Y.Z` rebuilds the Android APK release only

If you decide to publish a release without working desktop builds, inspect its
assets first, then publish it manually:

```bash
RELEASE_LOOKUP=$(node scripts/github-release.mjs --repo longbkit/clisbot --tag vX.Y.Z)
gh release view "$RELEASE_LOOKUP" --json isDraft,isPrerelease,assets
gh release edit "$RELEASE_LOOKUP" --tag vX.Y.Z --draft=false

# Keep a beta marked as a prerelease:
RELEASE_LOOKUP=$(node scripts/github-release.mjs --repo longbkit/clisbot --tag vX.Y.Z-beta.N)
gh release edit "$RELEASE_LOOKUP" --tag vX.Y.Z-beta.N --draft=false --prerelease
```

This bypasses the updater-manifest guarantee. Use it only when the release is
intentionally unavailable to desktop updater clients.

## Notes

- `version:all:*` bumps root + syncs workspace versions and `@clisbot/*` dependency versions
- The npm `version` lifecycle regenerates F-Droid changelog files from `CHANGELOG.md` for stable releases only (`npm run fdroid:changelogs`) and stages them, so the release tag carries them. Betas are a no-op. A stable run **aborts the release** if `CHANGELOG.md` has no entry for the version being cut — commit the changelog entry first. See [docs/android.md](android.md) for why these files are generated per ABI.
- `release:prepare` refreshes workspace `node_modules` links to prevent stale types
- `npm run dev:desktop` and `npm run build:desktop` target the Electron desktop package in `packages/desktop`
- If `release:publish` partially fails, re-run it — npm skips already-published versions
- If `release:publish:beta` partially fails, re-run it — npm skips already-published versions and keeps prereleases off `latest` because every publish uses `--tag beta`
- The website uses GitHub's latest published release API for download links, so published beta prereleases do not replace the stable download target.

## Changelog format

Release notes depend on the changelog heading format. The heading **must** be strictly followed:

```
## X.Y.Z - YYYY-MM-DD
## X.Y.Z-beta.N - YYYY-MM-DD
```

No prefix (`v`), no extra text. `Release Notes Sync` matches the `## X.Y.Z` (or `## X.Y.Z-beta.N`) line for the pushed tag to extract the version. A malformed heading breaks the release-notes sync for that tag.

`CHANGELOG.md` on `main` is also what the app's **What's new** sheet fetches and renders, so the file is a shipped product surface, not just a release input. `##` starts a release and `###` starts a section; the app reads section titles from the document, so renaming or adding one needs no app change. Content between the release heading and the first `###` is the release's [highlights](#changelog-highlights). The What's new sheet, the website changelog and the GitHub release body show the highlights and keep the sections collapsed behind one control: Show all changes in the app and on the website, and an All changes `<details>` block that `Release Notes Sync` writes into the release body, so the file itself never needs HTML. A release with nothing before its first `###` shows its sections. Older entries that open with summary paragraphs are treated as highlights. The app, the website and the release scripts each parse the file with their own code, and installed apps keep the parser they shipped with, so those two heading rules are fixed: new kinds of content go inside the highlights or a section as Markdown, never behind a new heading level or marker. `scripts/test-support/changelog-structure.json` holds the cases all three parsers are tested against; change a structure rule there first. Everything under a section is rendered as Markdown: prose, lists, links, inline code, fenced code, block quotes, tables, and images. Raw HTML does not render — the shared Markdown parser runs with `html: false`, so a `<video>`, `<iframe>` or `<embed>` tag reaches the reader as visible markup. Keep media out of the changelog, or link to it. A GitHub callout renders as a block quote with its `[!NOTE]` marker still in the text. A release entry is what a user reads on a phone the moment they are offered the update — write it for them.

## Changelog policy

- `CHANGELOG.md` holds stable releases and at most one entry for the current beta series.
- The first beta of a version inserts a top entry like `## 0.1.60-beta.1 - YYYY-MM-DD`.
- Each subsequent beta rewrites that entry in place: the heading becomes the new beta number and date, and the body describes the full change from the previous stable release to this beta. Never add a second beta entry.
- The entry announces changes and leaves setup steps, click paths, migration notes, configuration keys, hedges and edge cases to product docs. The headline change is the first highlight. [Changelog conciseness](#changelog-conciseness) and [Changelog ordering](#changelog-ordering) hold the rules.
- The entry is a list of changes, not of PRs. When a later beta reverts, reworks, or follows up on something an earlier beta added, rewrite the bullet to the current behavior or delete it. A stable user never saw the earlier beta behavior, so fixes to it are not "Fixed" bullets.
- Anything that already shipped to stable through a patch release on an older line stays out of the beta entry.
- Stable promotion renames the entry to `## 0.1.60 - YYYY-MM-DD` after a final review.

Older prerelease bodies on GitHub keep the notes they were synced with; `Release Notes Sync` only writes the release whose tag matches the top entry.

## Changelog translations

`CHANGELOG.zh-CN.md` holds the Chinese notes for `clisbot.com/zh-CN/changelog`. Only the website reads it; the app's **What's new** sheet, GitHub release bodies and F-Droid read `CHANGELOG.md`.

- The release agent writes the Chinese entry in the changelog commit, after the English entry is approved. Every beta that rewrites the English entry rewrites the Chinese one too, and promotion renames both. `packages/website/e2e/i18n.spec.ts` fails CI on the release commit when any entry has no current translation.
- A translated entry uses the English heading unchanged: `## X.Y.Z - YYYY-MM-DD`. The website uses it only while the version and date both match the English entry. Otherwise it shows that release whole in English under a notice. Delete Chinese entries whose English entry was renamed.
- Keep the English highlights, sections, bullets and links one to one. Section titles: Added 新增, Improved 改进, Changed 变更, Fixed 修复, Security 安全, Breaking 破坏性变更, Plugins 插件, Notes 说明. Wording follows [website-i18n.md](website-i18n.md#chinese-style).

## Changelog ownership

- **The agent running the release writes the changelog entry — beta or stable.** The release context and final wording stay with that agent.
- **Commit history is only an index of the changes. Never draft the changelog from commit subjects or diffs alone.** For every PR in the release range, read the full PR description and every issue it links to before deciding what changed, why users care, or how changes should be grouped. Use the implementation only to verify the resulting understanding.
- Every entry, beta or stable, is drafted from the previous stable release to the release source. For a later beta, read the PRs since the previous beta tag, then rework the existing entry so each bullet still describes current behavior. Review the result against the changelog policy below, show it to the user, and wait for approval before committing it.

## Changelog wording

The changelog is shown on the Clisbot homepage. Each bullet is a compact factual record of
product behavior that changed.

- **Name the exact change.** Prefer `Added <capability>`, `Removed <behavior>`,
  `Changed <behavior>`, or `Fixed <failure> when <condition>`.
- **Keep the scope exact.** A conditional bug is not a general reliability problem. Do not
  broaden one failure into claims that Clisbot is now faster, smoother, responsive, or reliable.
- **Use concrete product and runtime terms.** Git polling, persisted cache, provider catalog,
  and WebSocket reconnects can identify the affected behavior. Component names, internal
  modules, code symbols, and implementation techniques cannot: omit `WorkingIndicator`,
  `reconcileAndEmitWorkspaceUpdates`, remounts, memoization, and controlled inputs.
- **State the consequence only when the change itself is unclear.** Keep the condition that
  makes the consequence true. Do not replace a precise change with a broad benefit claim.
- **Do not invent context.** Mention an upgrade, platform, workload, or user action only when
  the PR or linked issue establishes that scope.

| Avoid                                                        | Write                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| Clisbot stays responsive with many idle Git workspaces       | Removed periodic Git polling for idle workspaces      |
| Incompatible saved app data no longer crashes after upgrades | Fixed crash when persisted cache was incompatible     |
| Splitting layouts no longer remounts the active agent        | Fixed scroll position resetting when splitting a pane |
| Mobile model selector is faster and more straightforward     | Added search to the mobile model selector             |

Test each bullet against the source PR and issue: can a reviewer point to the exact behavior
that changed, the failure that was fixed, or the capability that was added? If the bullet only
claims a general improvement, rewrite it with the concrete change.

- **Use the entry's release scope.** Include changes within the matching range in **Changelog scope**.
- **Collapse internal iterations within that scope.** Present a feature added and fixed in one range as working.
- **Cut low-signal entries.** "Toolbar buttons have consistent sizing" is too granular. Combine small polish items or drop them.

## Changelog conciseness

An entry announces what changed. Product docs own setup, navigation, migration and edge cases, and the PR link leads to the rest. These rules apply to highlights and section bullets.

- **No instructions.** Cut setup steps, click paths, configuration keys, flags and migration notes. "Open a provider's settings from Settings, setup, or the model picker" is a click path. "Existing goose settings and sessions carry over to the bundled plugin" is a migration note.
- **One warning for a breaking requirement.** When the update stops something working until the user acts, state the requirement in one short sentence after the announcement, and link the product doc that has the steps: "Requires [Antigravity CLI 1.5.0 or later](https://clisbot.com/docs/supported-providers/antigravity)." Nothing else earns a second sentence.
- **No hedges or exception clauses.** Cut "when needed", "for eligible models", "on hosts where…", "except…", "with a hint shown when…" and "across common install shapes". Keep the condition that triggers a fixed failure, as in `Fixed <failure> when <condition>`.
- **The shorter bullet is still true.** When a change reaches only some providers, platforms or file types, name what it covers in the sentence's own words: "update supported CLIs" where one provider has no update command, "Markdown previews and source views" where HTML previews on iOS are left out, "by default" where an explicit interrupt still replaces the turn. Do not widen the claim to remove a clause.
- **State the outcome and stop.** Say what the user gets. Leave out queues, snapshots, caches, timeouts, LAN/WAN topology, TLS handshakes and IPC.

Each row is from the first draft of 0.17.1:

| Avoid                                                                                                                                                                                                                                                     | Write                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Open a provider's settings from Settings, setup, or the model picker to update supported CLIs and watch their output                                                                                                                                      | Update supported CLIs from the app                                                                |
| Use Antigravity CLI 1.5.0 or later on the daemon host, and include `acp` if you override its command                                                                                                                                                      | Requires Antigravity CLI 1.5.0 or later                                                           |
| Reports and notifications from other agents arrive in order when the current turn ends instead of interrupting it. An interrupt or your own prompt carries earlier queued messages in the same turn, and Stop holds queued messages until the next prompt | By default, messages from other agents wait for the current turn to end                           |
| Changed worktree teardown to keep the worktree when the command exceeds one minute or the `worktree.teardownTimeoutMs` limit in `clisbot.json`                                                                                                            | Changed worktree teardown to keep the worktree when the command times out                         |
| Fixed file views losing their scroll position when switching Preview and Source, except HTML previews on iOS                                                                                                                                              | Fixed Markdown previews and source views losing their scroll position when switching between them |

Section bullets also follow these limits:

- **One sentence per bullet, max.** A second sentence is documentation. Cut it.
- **No trailing periods.** Bullets are list items, not prose. Drop the period at the end of every bullet, including the period inside any bolded lead-in. `**Configurable terminal scrollback**` not `**Configurable terminal scrollback.**`.
- **One line per bullet.** If a bullet wraps to three lines in a narrow column, it's too long.
- **Split bullets that pack multiple distinct changes.** If a bullet uses "and", "plus", a comma list, or an em-dash to chain several independent improvements, break them into separate bullets — even when they share a theme or author. One bullet = one user-facing change.
- **Attribution follows the split.** When you split a dense bullet, move each PR/author to the bullet it belongs to. Never duplicate the same PR across multiple bullets.

## Changelog highlights

Every release entry leads with highlights: the changes a user would name first when asked what is
new. They are a list above the first `###` section, ranked as
[Changelog ordering](#changelog-ordering) describes. The sections below are the full record; a
reader who stops after the highlights should have missed nothing they would ask about.

```markdown
## 0.16.0 - 2026-11-20

- **Undo workspace archive:** Restore an archived workspace with Undo or Cmd/Ctrl+Z. ([#8904](https://github.com/longbkit/clisbot/pull/8904))

### Added
```

- **The lead-in names what is new in four words at most.** Bold it, colon inside the bold. A reader
  who sees only the bold words should know what this release added or changed. A category lead-in
  such as `**Polish:**` gathers several related changes.
- **The lead-in is not a place or something Clisbot already had.** A device, screen or area names
  where the change landed. A feature name that was true of the last release hides the news: Clisbot
  already had keyboard shortcuts, so the lead-in says they now work on mobile.
- **One short sentence says the plain thing.** Write what a user would tell a friend: Clisbot now
  shows the background tasks an agent is running. Leave out the conditions and mechanics that make
  it true. A second sentence is only for a
  [breaking requirement](#changelog-conciseness).
- **Describe the new behavior, not the old one.** Say what is faster or better now, and do not
  dwell on how slow or broken it was before. A number is welcome as a short aside after the new
  behavior is stated: seconds, a percentage, a multiple.
- **Do not list what a sentence already covers.** After "the same shortcuts as desktop", naming
  five of them adds nothing. Keep a list only when it sets the scope, such as the providers a
  feature works with.
- **Sentences end with periods, and the attribution follows the last one.**
  [Changelog wording](#changelog-wording) and [Changelog conciseness](#changelog-conciseness)
  apply.
- **A highlight replaces the section bullets it covers.** A PR appears once in an entry, so its
  attribution moves to the highlight.
- **A highlight is something a user would name.** Everything else stays a section bullet. A patch
  release still has one: the change it ships for.
- **Fixes are routine and stay in `### Fixed`.** Do not add a summary of fixes. A fix, or a group
  of related fixes, becomes a highlight only when it passes the same test as a feature, and then
  it is written as what works now: `**Fewer reconnects on return:**`.

| Avoid                                                                                      | Write                                                                               |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `**iPad and touch screens:**`                                                              | `**Touch-sized tablet controls:**`                                                  |
| `**Hardware keyboard shortcuts:**`                                                         | `**Keyboard shortcuts on mobile:**`                                                 |
| When an agent ends its turn while shells it started are still running, a pill lists them   | Clisbot now shows the background tasks an agent is running                          |
| A diff no longer waits 4 to 40 seconds behind worktree scans                               | Opening Changes shows the file tree right away, and diffs load about 6 times sooner |
| The same shortcuts as desktop: command center, file picker, new workspace, workspace jumps | The same shortcuts as desktop, including your custom bindings                       |

Before showing a draft, read only the bold lead-ins top to bottom. Each one must answer "what is
new?" without its description, and each must outrank the one below it.

## Changelog attribution

Every changelog bullet must credit contributors and link to the PR(s) that delivered the change. This is not one-PR-per-line — a single bullet describes a user-facing change and may reference multiple PRs.

Format: append `([#123](https://github.com/longbkit/clisbot/pull/123) by [@user](https://github.com/user))` at the end of each bullet. For changes spanning multiple PRs or contributors:

```markdown
- Voice mode now works on tablets with proper microphone permissions. ([#210](https://github.com/longbkit/clisbot/pull/210), [#215](https://github.com/longbkit/clisbot/pull/215) by [@alice](https://github.com/alice), [@bob](https://github.com/bob))
```

Rules:

- **Always link the PR number** as `[#N](https://github.com/longbkit/clisbot/pull/N)`.
- **Always link the contributor's GitHub profile** as `[@user](https://github.com/user)`.
- **One bullet = one user-facing change**, regardless of how many PRs went into it. Group related PRs on the same bullet.
- **De-duplicate contributors.** If the same person authored multiple PRs in one bullet, list them once.
- **Only credit external contributors.** Skip attribution for [@boudra](https://github.com/boudra). The changelog credits community contributions — core team work is the default.
- **Credit the commit author, not the PR opener.** A maintainer often opens a PR that lands work authored by someone else (cherry-pick, rebase of a contributor's branch, manual extraction from a stacked PR). The squash commit preserves the original commit's author, but `gh pr view N --json author` returns the PR opener — using that field will silently mis-credit the work to the maintainer (and then the "skip @boudra" rule drops the attribution entirely). Always resolve attribution from commit authors.

  Use this command to get the GitHub logins for each PR:

  ```bash
  gh pr view N --json commits --jq '[.commits[].authors[].login] | unique | .[]'
  ```

  This returns every distinct GitHub login that authored or co-authored a commit in the PR. Use those logins for attribution. Fall back to `gh pr view N --json author` only if the commits command returns nothing (which should not happen for merged PRs).

  When listing PR numbers, `git log --cherry-pick --right-only --no-merges --format='%H %s' v<previous>...<release-source-sha> | grep -E '\(#[0-9]+\)$'` pulls the PR number out of squash commit subjects and skips commits the previous stable already shipped as cherry-picks.

## Changelog ordering

Rank highlights by how much of a user's day the change touches: how many users get it, and how
often they meet it. Put every highlight in one of four groups, then order each group by the same
question.

1. **New capabilities.** Something a user could not see or do in the last release:
   `Background tasks`, `Plugin sidebar views`.
2. **Everyday things that got better.** Speed, steadiness and polish in what users already do
   every session: `Faster diff loading`, `Polish`.
3. **Changes for part of the audience.** They need a particular device, provider or setup:
   `Keyboard shortcuts on mobile`, `Touch-sized tablet controls`.
4. **Small conveniences and highlighted fixes.** A user is glad to find them and would not update
   for them: `Undo workspace archive`, `Fewer reconnects on return`. Fixes are routine, so one
   that earned a highlight still follows everything new or improved.

- **The headline change goes first, whatever its group.** It is the change the release is announced
  with. 0.17.1 leads with `Antigravity approvals and history`, which needs one provider. The groups
  rank everything after it.
- **Reach decides before kind.** A new capability that needs a hardware keyboard is in group 3.
- **Rank the whole list in one pass.** The order you collected the pull requests in, the alphabet
  and the order of the sections below are not rankings.
- **Show the groups with the draft.** List each highlight under its group when you ask for
  approval, so the maintainer corrects the test and not one position.
- **A maintainer's note that a change is big moves that change up.** It does not rank the changes
  it names against each other, and it does not lower the ones it leaves out.
- **A correction to one highlight is a correction to the test.** Work out which group or question
  you got wrong, rank every highlight again, and then edit the file. Moving only the named item
  leaves the same mistake in the others.

Bullets within each section (Added, Changed, Fixed) follow this order:

1. **User-facing features and changes first** — things users will notice, want to try, or that change their workflow.
2. **Quality-of-life improvements** — polish, performance, smoother interactions.
3. **Internal/infra changes last** — only include if they have a tangible user benefit (e.g. "faster startup" is user-facing even if the fix was internal).

## Pre-release sanity check

Before cutting a **stable** release, the release agent reviews the diff as a last line of defence against shipping bugs. Skip this for betas — the beta itself is the smoke test, and gating each beta on a code review defeats the point of using betas as fast release candidates.

Review the diff between the latest release tag and the resolved release source. Focus on:

1. **Breaking changes** — especially in the WebSocket protocol, agent lifecycle, and any server↔client contract.
2. **Backward compatibility** — the important direction is old app clients talking to newly updated daemons. Users update desktop and daemon first, then keep running the old app for a while. Flag anything that breaks old clients against new daemons or requires both sides to update in lockstep.
3. **Regressions** — anything that looks like it could break existing functionality.

Use `git diff <latest-release-tag>..<release-source-sha>` as the review input. This is a deep sanity check, not a full code review. If anything looks risky, investigate before proceeding and surface the finding to the user.

## Changelog scope

Changelog scope follows the release being described:

Every entry covers `previous stable release → release source`: first beta, later beta, direct stable release, and promotion alike. The beta entry always reads as the stable entry would if the beta were promoted today.

## Completion checklist

### Beta release

- [ ] The resolved release source is the intended commit (default `origin/main`) and its existing CI is green
- [ ] Every PR in the release range has been opened, and its full description and every linked issue have been read before drafting the changelog
- [ ] Fold this beta into the series' single `CHANGELOG.md` entry (heading `## X.Y.Z-beta.N - YYYY-MM-DD`, previous stable → release source), review it against the changelog policy, get approval, and commit it with its [`CHANGELOG.zh-CN.md` translation](#changelog-translations) before cutting the release
- [ ] The diff from the previous stable to the resolved release source is classified as patch or minor, with the target version and rationale approved
- [ ] Release preparation stayed local until the approved release command pushed the complete branch and tag
- [ ] `npm run release:beta:patch`, `npm run release:beta:minor`, or `npm run release:beta:next` completes successfully
- [ ] Every GitHub Actions run for the complete release commit and tag is green
- [ ] npm shows the version under the `beta` dist-tag, not `latest`
- [ ] The GitHub prerelease was published only after the three beta manifests were uploaded, and it has the changelog body and every expected macOS, Linux, Windows, and Android APK asset
- [ ] GitHub `Desktop Release` workflow for the `v*-beta.N` tag is green
- [ ] The GitHub prerelease contains `beta-mac.yml`, `beta-linux.yml`, and `beta.yml`
- [ ] GitHub `Android APK Release` workflow for the same tag is green
- [ ] GitHub `Docker` workflow is green and the versioned beta image is published without moving `latest`
- [ ] GitHub `Release Notes Sync` mirrored the beta entry into the prerelease body
- [ ] EAS `Release iOS Beta` completed its build, TestFlight distribution, external beta group, and Beta App Review path
- [ ] The release heartbeat was created after the tag push and deleted only after every item above passed

### Stable release (or promotion)

- [ ] Run the pre-release sanity check (see above) and address any findings
- [ ] The diff from the previous stable to the resolved release source is classified as patch or minor, with the target version and rationale approved
- [ ] The resolved release source is the intended commit (default `origin/main`) and its existing CI is green
- [ ] Every PR in the release range has been opened, and its full description and every linked issue have been read before drafting the changelog
- [ ] Ensure the approved release inputs are committed locally and the git worktree is clean before running any release command
- [ ] Ensure local `npm run typecheck` passes on that exact commit before running any release command
- [ ] Update `CHANGELOG.md` with user-facing release notes (features, fixes — not refactors). Promotion renames the series' `## X.Y.Z-beta.N` entry to `## X.Y.Z - YYYY-MM-DD` and re-checks it covers the full release. Commit the matching [`CHANGELOG.zh-CN.md` entry](#changelog-translations) with it
- [ ] Verify the changelog heading follows strict `## X.Y.Z - YYYY-MM-DD` format
- [ ] Release preparation stayed local until the approved release command pushed the complete branch and tag
- [ ] `npm run release:patch`, `npm run release:minor`, or `npm run release:promote` completes successfully
- [ ] Every GitHub Actions run for the complete release commit and tag is green
- [ ] Move npm's `beta` dist-tag to the new stable version for every published package and verify both `latest` and `beta` resolve to it
- [ ] The GitHub Release was published only after the three stable manifests were uploaded, and it has the changelog body and every expected macOS, Linux, Windows, and Android APK asset
- [ ] GitHub `Desktop Release` workflow for the `v*` tag is green
- [ ] The GitHub Release contains `latest-mac.yml`, `latest-linux.yml`, and `latest.yml`
- [ ] `latest-mac.yml` contains the current `minimumSystemVersion` guard
- [ ] GitHub `Android APK Release` workflow for the same tag is green
- [ ] GitHub `Docker` workflow is green and both the versioned and `latest` images are published
- [ ] GitHub `Release Notes Sync` is green and the release body matches the stable changelog entry
- [ ] EAS `Release Mobile` workflow for the same tag is green
- [ ] EAS iOS `build_ios` completes for the same tag
- [ ] EAS iOS `distribute_ios` succeeds, uploading the binary once, distributing it to `Clisbot Beta`, and submitting it for Beta App Review
- [ ] EAS iOS `submit_ios_for_review` succeeds, putting the build into App Store review
- [ ] EAS Android `build_android` completes for the same tag
- [ ] EAS Android `submit_android` succeeds, putting the build on its Play Store track
- [ ] The release heartbeat was created after the tag push and deleted only after every item above passed
