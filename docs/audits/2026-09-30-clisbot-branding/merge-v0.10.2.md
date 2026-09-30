# Fusion merge of rebranded upstream v0.10.2

**CURRENT, 2026-10-01:** the user confirmed Slack works and approved promoting `rebrand/clisbot-fusion-test` to `main`, including the channel packaging fix at `a21735240`. The original `clisbot-paseoclaw-fusion` branch remains unchanged.

## Main cutover acceptance (2026-10-01)

- Accepted runtime code: `a217352407fbe59e2a798afbf20a824b73ad74bf`.
- Additional evidence: the user reported a successful Slack test after the runtime fix.
- The promotion includes this documentation-only acceptance record. No further
  runtime changes are part of the cutover.
- Old `main` and its GitHub backup `clisbot-v1-tmux-acp-deprecated` were both
  checked at `21baca297f5995fb1dd3d0dc354d64a252dba9e9` before promotion.
  GitHub rejected force-with-lease because `main` forbids non-fast-forward updates.
  The cutover instead merges old `main` into the accepted Fusion tip using the
  `ours` strategy, preserving both histories and Fusion's code. Only this
  documentation changes in that merge; a normal push advances `main` without
  changing its protection rules. This strategy is not used for upstream syncs.
- The user accepted the candidate after the remaining regression checks and
  temporary upstream service endpoints had been disclosed. These remain
  follow-up work; unrun checks are not recorded as passing. The known cleanup
  failure predates the upstream merge. Publication/store/Nix work remains open.
- Keep the original Fusion and rebrand test branches for reference. This
  acceptance does not create a release or a `sync-verified-*` tag.

## Inputs and ancestry

| Role                      | Ref / commit                                                                |
| ------------------------- | --------------------------------------------------------------------------- |
| Fusion before merge       | `b5fa423531159447f82be71fa2ebfe03c870eb7d`                                  |
| Rebranded upstream parent | `rebrand/upstream-v0.10.2-test`, `d4991268c11a27c77644654157cff02fda747331` |
| Raw upstream v0.10.2      | `919c737c1948c5a16220307403a82e90d3e27ea0`                                  |
| Actual Git merge base     | raw v0.10.0-beta.1, `52d345db7f271251787c1099a2fe48fde515f012`              |
| Destination               | `rebrand/clisbot-fusion-test`                                               |

Command: `git -c merge.conflictStyle=zdiff3 merge --no-ff --no-commit rebrand/upstream-v0.10.2-test`.

The source carries 25 upstream commits after the old baseline. The [independent validation](upstream-v0.10.2-validation.md) records the rebrand input and build evidence. Use `git log --merges --first-parent rebrand/clisbot-fusion-test -1` to find this merge's final SHA; its two parents are the exact Fusion and rebranded-upstream commits above.

## Actual conflicts

Git reported **75 files / 179 conflict hunks**. Counts below were captured before resolving anything. “Fusion lines” and “upstream lines” count the text inside their respective conflict arms; they exclude marker lines, common context and the base arm. These are conflict-content counts, not net added/deleted lines.

| Folder                        | Conflict files |   Hunks | Fusion lines | Upstream lines |
| ----------------------------- | -------------: | ------: | -----------: | -------------: |
| `(root)`                      |              4 |      33 |          359 |            122 |
| `docker`                      |              4 |      10 |          107 |             86 |
| `docs`                        |              6 |      12 |          134 |             16 |
| `packages/app`                |             15 |      19 |           90 |             29 |
| `packages/cli`                |              5 |      12 |           47 |              9 |
| `packages/client`             |              2 |       3 |           10 |              5 |
| `packages/desktop`            |              2 |       2 |           13 |              1 |
| `packages/expo-two-way-audio` |              1 |       1 |            1 |              1 |
| `packages/highlight`          |              1 |       1 |            1 |              1 |
| `packages/plugin`             |              1 |       3 |            5 |              5 |
| `packages/protocol`           |              2 |       2 |            2 |            119 |
| `packages/relay`              |              1 |       1 |            1 |              1 |
| `packages/server`             |             24 |      51 |          390 |             92 |
| `packages/website`            |              2 |       2 |          826 |            546 |
| `public-docs`                 |              5 |      27 |          204 |             43 |
| **Total**                     |         **75** | **179** |     **2190** |       **1076** |

The [evidence JSON](evidence/merge-v0.10.2.json) contains every path, original stage blob IDs, per-file hunk/line counts and resolution classification. Initial conflict-marked copies and all logs are retained locally at `/Volumes/Media/clisbot-builds/merge-v0.10.2-20260930`.

### Resolving the rename overlap

To distinguish rename overlap from functional edits, we exported the **actual raw merge base** into a temporary directory and ran the exact text/publication/ports and visual transforms from Fusion `b5fa42353`, with the same endpoint exception and Expo configuration. We formatted that snapshot with the same formatter. This normalized copy was used only to compare and merge file contents; Git's actual base and commit ancestry were not rewritten.

| Classification after normalizing the base   | Files | Resolution                                                                   |
| ------------------------------------------- | ----: | ---------------------------------------------------------------------------- |
| Upstream equals normalized base             |    57 | Keep Fusion, since upstream has no additional content change in these files. |
| Fusion equals normalized base               |    10 | Take upstream, including the OpenCode session update and release versions.   |
| Both changed, clean three-way content merge |     6 | Combine both changes; inspect the resulting diff.                            |
| Still overlaps                              |     2 | Reconcile CLI dependencies and lockfile as described below.                  |

The six clean combinations were `CHANGELOG.md`, `docs/providers.md`, root/app/server `package.json`, and `agent-manager.ts`. The two remaining files were `packages/cli/package.json` and `package-lock.json`: take version `0.10.2` for the upstream packages while preserving the Fusion Hub dependency at its own `0.7.3-beta.1` version. Recursive JSON merging of the lockfile found **zero incompatible scalar changes**; existing dependency resolutions were preserved.

Review also found two unchanged Hub dependency pins that Git could not flag: `@clisbot/protocol` and `@clisbot/relay` still requested `0.10.0-beta.1`. They and their lockfile entries now request `0.10.2`. A clean `npm ci` and workspace dependency listing verified the result.

### Representative cases

1. **Fusion's added configuration:** `packages/app/app.config.js` conflicted around renamed environment declarations and Fusion's `CLISBOT_HUB_ORIGIN` validation. Upstream matched the normalized base, so keeping Fusion preserved the configured Expo project and reusable test profile.
2. **A genuine upstream edit on renamed code:** OpenCode `v2/session.ts` moved environment restoration into connection reconciliation and added long-turn/context-usage fixes. Fusion matched the normalized base, so taking upstream retained those fixes. Keeping the entire Fusion file would have discarded them.
3. **Shared manifest with an adjacent Fusion insertion:** upstream bumped the CLI's internal dependencies, while Fusion had inserted `@clisbot/hub` between them. The final object includes both the new versions and the Hub dependency.
4. **No text conflict, but a semantic issue:** the upstream fast-background-turn test exposed Fusion's asynchronous event ordering. A provider's delayed `turn_started` could arrive after the same turn's completion and reopen it as an autonomous run. `AgentManager` now ignores starts for already finalized turn IDs. The test asserts the accepted `running` response at the queue boundary, subsequent `idle`, and exactly one parent notification. Its upstream counterpart passes independently; the original Fusion integration failed before this fix.
5. **An older test matcher:** Fusion injects the Hub-enabled flag after the initial daemon connection hint. The web UI bootstrap fixture still expected the hint to end the script. Its matcher now accepts the separating semicolon; both trusted-proxy cases pass.

The merged content was also compared against normalized three-way candidates for every changed upstream path, including files Git had merged automatically. Before integration fixes, only the two manually reconciled JSON files differed.

## Resulting source delta

Against Fusion before the merge, excluding this audit, its evidence/screenshots and playbook links:

| Folder                        | Changed files | Lines added | Lines removed |
| ----------------------------- | ------------: | ----------: | ------------: |
| `(root)`                      |             3 |         +60 |           −32 |
| `docs`                        |             1 |          +2 |            −0 |
| `fastlane`                    |            12 |        +100 |            −0 |
| `nix`                         |             1 |          +1 |            −1 |
| `packages/app`                |            13 |        +454 |           −38 |
| `packages/cli`                |             2 |         +11 |            −6 |
| `packages/client`             |             1 |          +3 |            −3 |
| `packages/desktop`            |             1 |          +1 |            −1 |
| `packages/expo-two-way-audio` |             1 |          +1 |            −1 |
| `packages/highlight`          |             1 |          +1 |            −1 |
| `packages/hub`                |             1 |          +2 |            −2 |
| `packages/plugin`             |             1 |          +5 |            −5 |
| `packages/protocol`           |             3 |         +32 |            −3 |
| `packages/relay`              |             1 |          +1 |            −1 |
| `packages/server`             |            32 |       +1923 |          −192 |
| `packages/website`            |             5 |        +201 |            −1 |
| **Total**                     |        **79** |   **+2798** |      **−287** |

These counts include upstream changes and the integration corrections. They differ from the conflict table because most resolved rename conflicts leave the Fusion file unchanged.

## What this establishes about approach A

Renaming each release before merge preserves Clisbot names and makes the incoming changes reviewable. It does **not** eliminate textual conflicts: this first real merge still produced 75 files, largely because the common ancestor contains Paseo names. Normalizing a temporary copy of that base made the actual functional differences much easier to resolve.

After this merge, a newer raw upstream release descended from v0.10.2 will share **raw v0.10.2** with Fusion as its base, assuming no other shared ancestry changes that choice. It will not keep using v0.10.0-beta.1, and it will not automatically use our rebranded snapshot as its base. Some rename-overlap conflicts may therefore recur. Keep the transform repeatable and review semantic tests; do not promise a conflict-free next merge.

## Verification

- Clean install: `npm ci --no-audit --no-fund`, 3,484 packages; workspace dependency listing passed.
- Server/CLI build, production shared web UI export, website build and whole-workspace typecheck passed.
- App: **198 tests / 8 files** passed, including runtime/subagent state, sidebar imports, streamed text and file links.
- CLI: **72 / 4 files** passed. Protocol: **112 / 6 files** passed.
- Hub HTTP/backend: **15 / 2 files** passed. Channel-plane simulations: **11** passed using real Hub/SDKs with simulated Slack/Telegram and a simulated Host. Production Hub cold-start/PostgreSQL: **4** passed; the unrelated manual-source case was deliberately excluded.
- Server initial scope: **956 tests / 21 files**. Four initial failures were diagnosed; the MCP event-ordering issue and two bootstrap fixture cases were corrected. Follow-up affected suites: **336 / 4 files** passed, including the real-socket Bots/Chats create, direct/group messaging, duplicate delivery and restart scenario with a fake agent provider. One pre-existing Hub cleanup case remains below; final unique passing cases in this scope: **955**, with that one known failure.
- Production container `clisbot:merge-v0.10.2-test` (Linux arm64): build passed; `daemon`, `hub`, and `all` health/UI/port/restart/shutdown checks passed, including Hub failure propagation, shared UI cookie/CLI login, both WebSocket paths, malformed upgrades, per-client quotas, custom-port local onboarding and PostgreSQL smoke. The image includes the finalized-turn guard. An initial build was interrupted by the host Colima socket connection; retry through an isolated SSH socket to the same engine succeeded.
- Android production bundle export (development app variant): **passed**, 6,357 modules, Hermes bytecode 49.7 MB. This verifies native import/bundling, not device startup.
- Rename regressions: **12** passed. Text and visual repeat checks: **0 pending changes**.
- Production runtime: isolated daemon healthy, CLI v0.10.2 created a workspace, SDK WebSocket read it, Chrome displayed it and survived reload with **0 page errors**. Help points to `longbkit/clisbot`. [Desktop evidence](images/merge-v0.10.2-desktop.png), [mobile-width web evidence](images/merge-v0.10.2-mobile-web.png).
- Changed-source lint passed. Whole-repo lint reports **159 errors / 8 warnings in 54 unchanged paths**; every diagnostic file was byte-identical to the premerge Fusion commit. These are not a green whole-repo lint result.

## Verification follow-ups

### Packaged channel runtime follow-up

The full Docker acceptance test exposed `Runtime unavailable`: Hub SSR had
inlined relay code while leaving `tweetnacl` external, so npm's nested production
layout could not resolve it from Hub. Source tests and HTTP health missed this.
Keeping the four Hub workspace dependencies external fixes the resolution owner.
The package also omitted `channel-pins.json`; Hub now packs it and
`THIRD_PARTY_NOTICES`. Loading the installed verticals then exposed undeclared
imports: Slack needs `zod` and `typebox`, core needs `zod`, and Telegram needs
`typebox` and `undici`. Their manifests and lockfile now declare those dependencies.

The image build now runs `clisbot-hub-smoke.mjs` against the installed SSR bundle
and a temporary database: claim a disposable account, assert the authenticated
channel-status API reports `runtimeAvailable: true`, and load all seven packaged
channel entries/plugins without starting monitors or sending messages. The old
image fails the runtime assertion; the corrected image passes all seven loads.
The disabled-channel case returns the expected 404. On the updated test deployment,
the existing Slack account logs `channel daemon connected` and `channel plane
started`; account/Host data and volumes were preserved. This verifies startup,
not a real-agent Slack conversation round trip.

### Carried follow-ups at acceptance

- **Existing Hub failure cleanup:** `packages/server/src/server/hub/daemon-executions.test.ts`, “failed Hub create cleans durable state when provider close rejects”, leaves a live owned agent; the suite also reports three `SessionDeletedError` rejections from asynchronous worktree-bootstrap writes racing permanent deletion. Both the failed assertion and three rejections were reproduced from an archive of **premerge `b5fa42353`**, using the same installed dependencies. This needs a focused ownership/cleanup fix before calling that failure path verified. The merge did not introduce it.
- **Native acceptance:** the prior sidebar startup fix and reusable `tailnet-test-apk` profile are preserved. Native device/APK/iOS/Electron acceptance and real-provider/relay end-to-end checks are separate from the browser and simulated-provider evidence here.
- **Publication:** temporary upstream service endpoints remain by prior agreement. Apply the [publication review gates](publication-review.md#remaining-publication-decisions) before launch. This release also adds an Orca comparison page and a Philosophy section; inherited app-store availability, funding/independence, account/telemetry and plugin-directory claims still require Clisbot-specific editorial verification.
- **Nix:** upstream's npm-dependency hash was inherited; no Nix build was run for the expanded Fusion lockfile. Recompute/verify it before a Nix release.
- The earlier rebrand APK was built at `fd53207f3`; the postmerge Android bundle export passed. A new APK/device pass for subsequent client changes remains follow-up work. Main promotion was separately approved on 2026-10-01 as recorded above; this does not publish a release.
