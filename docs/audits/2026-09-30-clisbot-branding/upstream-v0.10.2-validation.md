# Upstream v0.10.2: independent rebrand validation

**CURRENT, 2026-09-30:** the selected release is [Paseo v0.10.2](https://github.com/getpaseo/paseo/releases/tag/v0.10.2), replacing v0.10.1 for the next Fusion merge. Validation completed on an isolated upstream branch. The subsequently authorized Fusion merge is recorded in [the merge audit](merge-v0.10.2.md).

## Exact inputs and branches

- Raw release commit: `919c737c1948c5a16220307403a82e90d3e27ea0`, fetched with `--no-tags` into `refs/upstream-releases/v0.10.2`.
- Transformed commit: `d4991268c11a27c77644654157cff02fda747331` on `rebrand/upstream-v0.10.2-test`.
- Worktree: `/Volumes/Media/clisbot-worktrees/rebrand-upstream-v0.10.2`.
- Merge destination: `rebrand/clisbot-fusion-test`, authorized by the user.
- Before the merge, the Fusion baseline was v0.10.0-beta.1. v0.10.2 adds 25 upstream commits from that baseline; it adds 7 commits / 32 changed files from v0.10.1.

The same Fusion-owned text transform, publication rules, ports and Flow/Ocean 02 bytes were applied to the raw release. Service endpoints remain upstream under the approved temporary exception. Expo uses the configured Clisbot owner/project. The [machine-readable evidence](evidence/upstream-v0.10.2-validation.json) records input hashes, exact paths and results.

## Coverage and counts

The text/path pass changed **2,175 files** and renamed **84 paths**. Visual application changed **64 paths** (55 assets and 9 source/configuration consumers); the two Fusion Hub consumers do not exist in raw upstream. Both checks returned **zero changes** after formatting and the final correction below.

Final Git diff against the raw release, including rename, publication edits, visual assets and formatting: **2,248 file entries, +19,955 / −20,319 text lines**, with 45 binary entries. Git rename detection is enabled; these are transformation counts, not merge conflicts. Binary content contributes no text-line count.

| Folder                        | File entries | Lines added | Lines removed | Binary entries |
| ----------------------------- | -----------: | ----------: | ------------: | -------------: |
| `(root)`                      |           19 |       1,558 |         1,446 |              0 |
| `.agents`                     |            2 |           2 |             2 |              0 |
| `.github`                     |           14 |         111 |           125 |              0 |
| `docker`                      |            6 |         145 |           145 |              0 |
| `docs`                        |           30 |         606 |           606 |              0 |
| `fastlane`                    |           48 |          64 |            64 |              4 |
| `nix`                         |            3 |         110 |           110 |              0 |
| `packages/app`                |          870 |       3,689 |         3,648 |             17 |
| `packages/cli`                |          170 |       1,478 |         1,444 |              0 |
| `packages/client`             |           31 |         448 |           434 |              0 |
| `packages/desktop`            |          108 |         889 |           857 |              8 |
| `packages/expo-two-way-audio` |            2 |           3 |             3 |              0 |
| `packages/highlight`          |            2 |           2 |             2 |              0 |
| `packages/plugin`             |           16 |          70 |            64 |              0 |
| `packages/protocol`           |           41 |         369 |           362 |              0 |
| `packages/relay`              |            6 |          10 |            10 |              0 |
| `packages/server`             |          639 |       8,007 |         8,162 |              0 |
| `packages/website`            |           78 |         520 |           964 |             16 |
| `plugin-examples`             |           67 |         133 |           133 |              0 |
| `public-docs`                 |           61 |       1,312 |         1,312 |              0 |
| `scripts`                     |           28 |         203 |           200 |              0 |
| `skills`                      |            7 |         226 |           226 |              0 |
| **Total**                     |    **2,248** |  **19,955** |    **20,319** |         **45** |

No tracked path retains `paseo` in its name. The remaining **238 matching lines in 81 files** are approved upstream service endpoints, source/README attribution, archived upstream articles, or upstream-account examples and test fixtures. Location/category details are in the evidence JSON. Runtime app/server/CLI/protocol sources contain no `PASEO_` environment names or `paseo://` handlers.

## Verification

| Gate                                                                     | Result                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------- |
| Fresh `npm ci`; `npm ls --workspaces --include-workspace-root --depth=0` | Passed; installed from transformed lockfile             |
| Daemon + CLI build; app dependency build                                 | Passed                                                  |
| Production browser export and daemon web UI packaging                    | Passed; 20.73 MiB raw / 4.62 MiB gzip / 3.39 MiB Brotli |
| Website client/server build and sitemap                                  | Passed                                                  |
| Whole upstream workspace typecheck and lint                              | Passed; lint 0 warnings/errors                          |
| Focused server tests: config, auth, web UI, OpenCode v2                  | 113 passed across 12 files                              |
| App connection/notification tests                                        | 19 passed across 3 files                                |
| Protocol deep links, daemon endpoints, SSH                               | 37 passed across 3 files                                |
| Rename regression suite in Fusion                                        | 12 passed                                               |
| Text and visual repeat checks                                            | 0 pending changes                                       |
| Commit hooks                                                             | Format, lint, typecheck passed                          |

The production supervisor ran on an OS-selected loopback port with an isolated `CLISBOT_HOME`. CLI v0.10.2 created a local workspace; the SDK connected over WebSocket and read the project/workspace. Chrome displayed the real workspace, survived reload and reported zero JavaScript page errors. The Clisbot mark was inspected on [desktop](images/upstream-v0.10.2-desktop.png) and [mobile-width web](images/upstream-v0.10.2-mobile-web.png). The Help issue action targeted `longbkit/clisbot`; its remote navigation was intercepted locally. Test daemon/browser processes were stopped afterward.

### Correction discovered during review

The general text replacement missed GitHub repository owners inside escaped regex URLs and `%2F`-encoded login return URLs. `sidebar-help.spec.ts` consequently expected the nonexistent `getpaseo/clisbot` destination. The transform now handles both encodings and repairs previously transformed matchers while preserving external relay-repository references. A regression test covers raw input, repair and repeat application. The fix was applied to both upstream and Fusion test branches; the real browser Help action was checked against the corrected matcher.

## Next gate and limits

The user subsequently authorized merging **`rebrand/upstream-v0.10.2-test` → `rebrand/clisbot-fusion-test`**. See [actual conflict files, causes, resolutions and integration gates](merge-v0.10.2.md). Retest Fusion-specific Hub proxy/auth, channels, Bots/Chats and Android startup after integration. Independent upstream validation does not establish those Fusion behaviors.

Native APK/iOS/Electron installers, live LLM turns and relay end-to-end behavior were not tested here. Temporary upstream endpoints and the publication decisions in [the publication review](publication-review.md#remaining-publication-decisions) remain release gates. `main`, the reference Fusion branch and the v0.10.1 test branch have not been changed. Promotion to `main` requires a separate user confirmation after acceptance.

Local run artifacts: `/Volumes/Media/clisbot-builds/upstream-v0.10.2-20260930`.
