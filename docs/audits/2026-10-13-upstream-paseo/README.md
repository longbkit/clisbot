# Pinned upstream main integration — CTO-015

Status: independently accepted by Atlas and integrated into local `main` on
2026-10-13. Reviewed candidate: `2b5bd1ce95601cc7a6e92caaad40afa095f7bc13`;
merge commit: `f2cf565bf688e6a7165854d6fa9b6e05e3c65738`. This final audit update
changes documentation only.
Procedure: [upstream sync playbook](../../guides/developer-guide/upstream-sync-and-contribution.md).
The owner explicitly authorized local promotion of this freshly fetched main snapshot
instead of a release tag. This exception does not authorize pushing, publishing,
deploying, live channel sends, or restarting the primary daemon/Desktop.

## Inputs and topology

| Role                                 | Commit                                     |
| ------------------------------------ | ------------------------------------------ |
| Clisbot pre-merge                    | `f87b35fcd0a92884f48624cdd935d9a38d15727a` |
| Previous upstream sync               | `9ae30c39e47a037cc85a45ae62cc76b70cb778f3` |
| Raw main, freshly fetched 2026-10-13 | `337e81a9c6d4551dbcede5930c21408776d06b1b` |
| Transformed snapshot                 | `ec8988c04f1d3ca4402df9b67fe5f384b5ba70ec` |
| Transform amendment                  | `afd712dac5570770fe4f6fce600c936ce6f8f74e` |
| Raw merge base                       | `ab10a6694ccf068959d1a6b67b6c915e21a9fe91` |
| Normalized base tree                 | `2aa7cfa53c8caa33f3817ec3a26dccb7d9c13437` |

Fetch completed at `2026-10-13T11:48:03Z` (Git remote-ref reflog). Raw main commit time: `2026-10-13T10:56:43+02:00`. Latest published release
`v0.11.2` is `75953250959979b8f088bbca8dbd6ee61d0151b1`, published
2026-10-09. It is a separate branch: 3 release-only commits and 81 main-only
commits after their common base. The merge uses pinned main, retaining both
histories through the transformed snapshot; no raw-upstream or `ours` merge.
Clisbot publication versions and internal pins remain `2.1.1-beta.1`.
`upstream-baseline.json` retains the published named-release provenance and adds
the reviewed main snapshot separately. This records source integration, not a release.

## Transform and conflicts

The existing transform needed one new README introduction recognition rule;
16 rename tests passed. Its amendment precedes the candidate merge. Normalized
base formatting now uses the npm script required by repository instructions.
The transformed index contains all 5,627 expected upstream paths plus four
branding assets. Rename and visual checks pass; upstream lint reports zero errors.

Git reported 273 conflicted files. Against the normalized base: 133 keep
Clisbot, 38 take upstream, 36 clean three-way merges, 63 real overlaps with
166 hunks, and 3 one-sided cases. Original copies and per-file classifications
are retained in the CTO evidence. App and server/protocol batches had disjoint
writers; root owns manifests, lock reconciliation, publication docs and integration.

Manifests retain both sets of scripts and Clisbot package identity. The existing
lock merge script followed by package-lock-only reconciliation returns exactly
the baseline lock bytes. Clean install and workspace dependency inspection pass.
The generated config schema is rebuilt from authoritative merged source. The
community page retains its current Clisbot publication: the incoming Vercel
reference runs a Paseo daemon, which Clisbot does not interoperate with.

The removed iOS text-reflow probe depended on upstream's deleted Python probe
and reverted resizing patch. Its fork changes were naming/safe invocation;
keeping it would test a reverted implementation. The hosted-Hub page stays
removed because Clisbot does not operate upstream's hosted Hub. Ignore rules
retain private/runtime exclusions, narrow fixture exceptions, and the new
Serena exclusion. Current Clisbot changelog and Nix dependency hash are retained;
Nix itself is unavailable here, so no Nix build is claimed.

## Semantic joins and findings

Cleanly merged files were reviewed alongside textual overlaps. Upstream
provenance and background-workspace discovery retain Clisbot durable submission,
full-content history/index, managed Project authorization and explicit Project
placement. New provenance/background fields remain optional; existing Clisbot
wire names and client capabilities remain accepted.

Confirmed findings required integration fixes:

- A provably undelivered prompt must not create a rejected human row that blocks
  marking its subsequent retry applied. The existing regression now asserts no
  row for the failed admission, exactly one delivered retry, and an applied ledger.
- Caller provenance and workspace inheritance must authorize the caller before
  creation's destination-Project early returns. A regression failed for foreign
  and missing callers before the fix; the authorizer and Bot-session files pass
  47 tests afterwards. Bot creation drops an obsolete MCP dispatch argument;
  its workspace, durable labels, launch defaults and finish behavior are retained.

- The new generic back/compact header reached Home's full Host runtime and native
  Crypto import through the relocated toggle. Three browser files passed 8 tests
  on the exact baseline and failed imports after the merge. Home navigation now
  lives in its own wrapper, supplied through a generic navigation slot; those
  same 8 tests pass again without new native-module mocks.
- A replacement's temporary `running` state hid an already failed provider start,
  causing an MCP send to report success. Failed starts now take precedence in
  run-start acknowledgement; the unchanged rejection assertion and added state,
  in-flight and notification-cleanup checks pass.

Independent parent review found **APP-1 (P2)**: upstream empty-project preservation
considered labels but omitted the fork user/channel metadata filter. A truly empty
Project survived a user filter, obscuring zero-result state. The focused real-browser
fixture reproduces this (expected 0 headers, received 1), then the narrow guard adds
`!hasMetadataFilter`. The fixture also checks no-filter and selected-Project-only
preservation, user/channel filters with background shown/hidden, and zero-result
recovery. Two focused production-browser cases pass in separate runs (user filter and
channel/zero-result recovery); the three affected sidebar unit files pass 19 tests.
The first green log covered only the user case; the separate channel case then
passed in 28.8 seconds against the unchanged export. Normal revision hooks and
independent acceptance are recorded in the CTO evidence.

The compact header preserves Home back navigation, managed Shell/profile access,
focused heartbeat controls, copy-path behavior and sidebar theme subscription.
A helper regression was corrected to accept the existing Home back control as
well as Open menu. Vietnamese includes the new upstream controls and review feedback.

Final survival covered 92 Clisbot commits: 8 flagged commits / 22 changed
lines, zero lost files and zero binary deltas. Each flagged line has an explicit
disposition in the CTO evidence: navigation and theme bridges were relocated,
selectors adapted, and publication provenance and Clisbot documentation retained.
The merged rename check has exactly the same 39 pending paths as the baseline
(legacy wire/crypto identities and historical provenance); the transformed
upstream check and final visual branding check both report zero changes.

## Verification

The exact pre-merge baseline has its own clean install and declarations. Candidate
clean install, workspace dependency inspection, server/channel/app-dependency and
browser-web builds, whole-workspace typecheck, lint and npm formatting pass.
The reconciled lock remains byte-identical to the baseline.

| Focused area                                                      | Result                                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Protocol / client / device authority / tool and heartbeat display | 27 / 200 / 11 / 51 pass                                                          |
| App fork owners, device access, sidebar, Hosts and i18n           | 1,492 pass; 3 browser imports fixed, 8 pass on both baseline and fixed candidate |
| App conflict owners                                               | 109 pass                                                                         |
| Agent/MCP/provenance/ACP/create-agent                             | 573 pass                                                                         |
| Session/web UI/bootstrap/proxy                                    | 187 pass                                                                         |
| Managed access/device/network                                     | 101 pass                                                                         |
| Session storage                                                   | 113 pass; 1 optional storage-ceiling case skipped                                |
| Connectors/chats/Bots/schedules                                   | 338 pass                                                                         |
| Changed Claude/Pi/OpenCode/proxy/diff owners                      | 399 pass                                                                         |
| Real-daemon filesystem, including relative symlink duplication    | 17 pass                                                                          |
| Highlight and dependency closure / keyboard                       | 52 / 162 pass                                                                    |
| Hub daemon and Host-client owners, PostgreSQL in Docker           | 169 pass, 13 fail identically on exact baseline and candidate                    |
| Native channel loader / vertical contract / simulated boot        | pass / pass / 11 pass                                                            |
| Desktop window/local transport/personal serving units             | 17 pass                                                                          |
| Isolated real macOS Electron hidden-frame window startup          | pass                                                                             |

The Hub comparison uses the same Colima Docker endpoint and test flags. All 13
failure headings and error messages match; raw logs remain available. The first
attempt lacked the Docker endpoint and was environmental, then rerun correctly.
No new failure is attributed to an old CI label.

Production browser export: 18 targeted Playwright cases pass for exact latest-call
previews, streaming/history/errors, desktop and touch web, migration and English/
Vietnamese labels, sidebar touch targets/navigation, and metadata filters. The
maintained tour saves desktop/light/dark, mobile, Vietnamese, settings, creation,
connections and Welcome screens with **0 page errors / 0 failed steps**. Its Create
bot selector was updated to the current accessible label.

An isolated real daemon completed a Codex `gpt-5.6-luna` turn; the exact reply was
read back. A Bot was created through the UI using model search, and its real reply
rendered. A future-dated heartbeat (Jan 1, 2027, max 1 run) was created and manually
run. The real `HEARTBEAT_OK` is present in provider history but absent in rendered
chat, including a fresh reload; its run marker remains. This also exercises durable
history after a quiet system turn. Test homes live outside the repository: the
initial in-repo home correctly rejected a Bot folder nested inside the existing
repository Project and was replaced with a normal isolated temp home.

Actual mixed-code-version flows pass: the pre-merge client reads candidate agent
lists/history; the candidate client creates an agent on the pre-merge daemon,
completes its real turn and reads the exact reply. This is a pre-merge/candidate
compatibility check, not a claim of an exhaustive historical-version matrix.

Every test/runtime child inherits an explicit fake Tailscale executable. No real
Serve mappings, primary daemon/Desktop restarts, deployed services or live channel
sends were used. The independent CTO-011 worktree and WIP were not incorporated.

## Remaining gates and limits

- Native iOS/Android startup/rendering and six-month historical app/daemon runtime
  combinations were not run. Additive optional wire shapes and capability gates
  were reviewed; ordinary pre-merge/candidate network flows pass.
- Full packaged Desktop/macOS/Windows/Linux smokes, Docker image builds and Nix
  are unrun. The isolated macOS Electron window contract is narrower evidence.
- Real Claude/Pi/OpenCode provider turns were not run; their affected ports/adapters
  pass focused tests. Real Codex turns pass.
- Live Slack/Telegram/other channel gates are **unrun by owner scope**. Simulated
  platforms do not establish real-platform behavior. No `sync-verified` tag.
- Direct automated selection of an offscreen model row times out identically on
  baseline and candidate; the supported model-search selection works. This is a
  specific reproduced existing limit, not a blanket scrolling/composer exemption.
- The optional storage-ceiling test is skipped without its explicit benchmark
  environment; bounded storage/index correctness tests pass.

The weakest evidence is native rendering/startup and full packaged cross-OS
operation. Canonical unrelated dirty docs have exact byte/diff backups and will
be rechecked immediately around the already-authorized local main promotion.

## Local integration and cleanup

Atlas independently accepted APP-1 and the focused server review, then issued final
acceptance for the reviewed candidate. Canonical `main` fast-forwarded from
`f87b35fcd0a92884f48624cdd935d9a38d15727a` to
`2b5bd1ce95601cc7a6e92caaad40afa095f7bc13`; no intervening commits needed
reconciliation. The staged area stayed empty. Both unrelated dirty docs retained
exact byte hashes and their complete binary-capable Git diff. Canonical workspace
dependencies resolve with the unchanged lock; no dependency-install churn.
Required generated outputs are refreshed without restarting the primary daemon.

The isolated test heartbeat was deleted after its completed one-run check. Only
task-owned candidate/baseline process groups were stopped; ports 7315 and 7316
are closed. Recovery/transform worktrees and evidence remain. Exact pre/post
commits, hashes, commands, readiness and cleanup PIDs are recorded in external
CTO evidence `integration.json`. No push, release or sync-verified tag.
