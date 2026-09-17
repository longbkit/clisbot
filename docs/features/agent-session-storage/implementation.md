# Agent session storage implementation evidence

Current checkpoint: 2026-09-13. [design.md](design.md) plus the per-iteration docs in [iterations/](iterations/) are the
approved acceptance contract. Implementation is underway; **no full AC/W criterion is
accepted yet**. Passing helper, store, or fixture-provider tests are identified
below and do not establish rendered app, native, real-provider, or production
performance behavior. User-authored design and acceptance requirements remain
unchanged.

## Current implementation

The persisted feature setting `features.agentSessionStorage` and
`PASEO_AGENT_SESSION_STORAGE` select capture, **default on in the Clisbot fusion** (upstream Paseo
defaults off; decided 2026-09-15 because workspace and message authorship — Created user, Updated
user, message senders — exist only when capture runs). `PASEO_AGENT_SESSION_STORAGE=0` or
`features.agentSessionStorage: false` turns it off; the site is tagged
`COMPAT(clisbot-session-storage-default)` in `packages/server/src/server/config.ts`. Optional
`server_info.features.agentSessionStorage` advertises capture. The separate optional
`agentSessionStorageRead` advertises retained durable reads, including rollout-off
sessions with the new layout. Hub identity tickets depend on capture, not on the
read flag. Existing `CLIENT_CAPS.agentSessionStorage` gates new read shapes.
The client now strips `pagingMode` and `allowDeferredPayloads` unless the connected
daemon explicitly advertises `server_info.features.agentSessionStorageRead`; capture
alone is insufficient. This is covered by the client capability matrix (5 cases,
including provider-subagent timeline requests) and the app capability test.

Timeline writes maintain a bounded `events.index.json` user-message anchor
projection (`messageId`, normalized preview, epoch, seq); replacement and reset
rebuild it from canonical rows. A focused store test covers ordering and epoch
association; canonical timeline reads do not depend on the derived index.
Malformed or missing anchor indexes now rebuild from the persisted timeline before
applying new writes, preserving earlier anchors; this fallback is covered by the
storage regression test.
Timeline records are also emitted in canonical envelope form to `events.jsonl`
with durable append and rewrite on replacement/reset; the legacy segmented reader
remains the compatibility read path until the unified journal migration is complete.
New durable submission and permission records use the same canonical stream with
their own `kind` values, while duplicate submission admissions do not emit a second
record. Existing focused submission/permission tests remain green.
When a segmented timeline is absent, reads hydrate it from valid `timeline`
envelopes in `events.jsonl` before applying normal cursor paging; this preserves
restart/read compatibility for canonical-only sessions.
Canonical timeline envelopes carry the source epoch, and hydrate restores that epoch
when rebuilding the compatibility journal; a canonical-only restart regression covers
sequence and epoch continuity. The same regression now verifies prompt-index reads
from anchors after the restart, without loading the full timeline into the caller.
Post-change focused storage gates pass: 4 files / 38 tests (storage, submissions,
session summary, and storage review). The 100,000-row projected cold-page benchmark
remains over the 300-second test budget and is not claimed as an acceptance pass.

Authorship uses optional scoped actor/channel snapshots, trusted per-operation Hub
identity tickets, persisted client-message admission, and pending/applied permission
records. Creator, last accepted message, last applied permission response and
participant/channel summaries carry durable ordering metadata. Startup inspects
bounded private checkpoints; missing/damaged indexes mark summaries pending without
rebuilding all histories during daemon readiness. Directory demand feeds a bounded
recovery worker, and viewing a session promotes recovery. Incomplete summaries
suppress the latest actor/time pair while preserving known participants.

The canonical journals retain main and provider-subagent rows, permissions, and
file links. Record migration preserves unknown fields and rejects conflicting
copies. Established session directories now remain stable across cwd changes,
restart, rollback and a legacy writer moving the record; duplicate candidate data
directories fail explicitly. The four location regressions passed on Sep 12.
Append acceptance waits for durable canonical commit. Paged derived indexes
serve display items and exact source coverage. The derived projection format is
currently **checkpoint v3**; older derived versions rebuild from unchanged canonical
journals. Permanent deletion records intent before any destructive timeline action,
then fences/drains file activity and removes the owning directory. Startup completes
interrupted deletion, including indexed duplicate legacy records; a disk fence
remains. Completed AgentStorage deleting-ID owners now release after a root-scoped
ID fence is persisted. Writes/loads check that fence, including changed-cwd
attempts. Repeat-delete/fresh-owner and scoped-intent recovery regressions passed;
FileStore's separate deleting-ID owner remains under lifecycle review. Upsert
records are cloned before the first await, so caller mutation cannot alter the
accepted record or cached value.

Uploads are connection-owned before linking and session-owned after admission.
Inline images receive durable draft metadata before bytes are created. Forks copy
only authorized source-session journal links, under a source lease; arbitrary text
cannot establish file ownership. TTL maintenance streams session/draft directories
and checks canonical links. Session-scoped downloads require a known linked file and
owning-agent authorization, including archived agents. Issued download tokens have
count/byte budgets and expire or release on use; overload never silently evicts a
live token.

Projected payloads above the 64 KiB inline display threshold use an explicit
`deferredPayload` descriptor; growing exact range vectors use `sourceSeqRangesRef`.
Neither changes canonical acceptance limits. Descriptor responses additionally
require `allowDeferredPayloads: true` on a source-range fetch: earlier source-range
clients receive complete items or an explicit legacy read-budget error. Immutable
scoped document/range RPCs page at most 64 KiB of UTF-8 text or 128 ranges and support
exact range point lookup. Unknown document IDs do not authorize cross-session
access or a history rebuild. The app must handle a deferred entry before its normal
renderer; full app integration remains under validation. Current derived document
storage uses immutable node files: disk allocation/write amplification is an
explicit pending measurement, not an accepted performance result.

Provider events reserve a slot in the
[pending event budget](../../../packages/server/src/server/agent/session-storage/pending-event-budget.ts)
(1,024 events / 8 MiB per agent) until they are written or released. A write that
never finishes holds every later event for that agent, so a stall on a slow disk shows
up as `Session history overloaded: pending provider event count limit exceeded`, not as
a write error. Grep `daemon.log` for `Session history write is stalled` (after 10 s) and
`Session event admission failed`; the second names the holder (pending run, steer
barrier, session queue, write tail). The two failures recover differently:

- **Failed write** (disk full, I/O error): stays failed until the daemon restarts,
  because acknowledged history may be missing.
- **Overload:** the turn is interrupted with its error kept on the agent. When every
  held event is written or released, the agent reads and accepts prompts again
  (`Session event admission recovered after overload`). While the write stays stuck,
  the agent stays locked.

App work includes actor labels/profile tabs, workspace Show/Hide and User/Channel
filters, one shared relative-time clock, authorship cache round trips, explicit
source-range coverage, parent/global retained-page budgets, subagent projected page
ownership, and permission-history controls. Live updates touching an incomplete
deferred item require authoritative projected refresh rather than local merging of
a preview. Actual workspace-route draft/reading-position and visual proof remain
outstanding.

## Acceptance status

“Partial” means executable implementation and some focused evidence exist; it does
not waive any remaining requirement in the feature README.

Each row names the criterion (code + Vietnamese/English title from
[goal-matrix.md](campaign-2026-09-12/ac-w-matrix.md)) and what it must be true of, so the table reads
standalone without the matrix.

| Criterion                                                                                                                                                                                                                                                                                                                                                 | Status                                  | Current evidence and remaining proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC1 — correct sender**: every user message shows the right person (name/avatar; ID when the name is missing); A/B alternation keeps the right person per message across retry/reopen/restart; two people are never merged into one author group.                                                                                                        | Partial                                 | Scoped actor schemas, trusted operation admission, message conflicts, permission snapshot/generation tests, cached authorship round trips. Full real Hub access-store/channel/provider alternation, cross-principal upload retry and rendered author grouping remain incomplete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **AC2 — profile in a tab**: hover name/avatar shows the ID; click opens a read-only profile tab (name, avatar, ID, source/scope, linked Member); re-click reopens it; the same ID under a different Hub/org/connection must not open the wrong person; draft + reading position are preserved on tab close/restore; touch + keyboard also open it.        | Partial                                 | Profile scope/identity, fields and component interaction tests exist; **web route + profile tab + draft/reading-position preservation Met-at-boundary (web)**: `session-profile.ui-contract.spec.ts` on the production static export (1 passed, 1.9 m, `/tmp/ui-ac2-run1.log`) — real styled shell with ID / Source / Hub / Organization / Connection / Member on the "Profile review" tab (`/tmp/ui-shots/ac2-workspace-profile.png`). Keyboard/touch open variants (a must-have) and native/relay remain unverified / Blocked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **AC3 — older history**: messages lacking a sender keep the old display, no fake avatar/sender; a session that receives a new message with metadata shows the new display only for that message; capture-off and old parsers still read the created layout.                                                                                               | Partial                                 | Optional fields and legacy reconciliation preserve unknown authors; default-off and old parser paths are covered. Four published-artifact API/CLI combinations passed; a rendered official app is not represented by the client package.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **AC4 — fast open**: with saved history, the first open reads only the nearest page + needed index (no provider init / full-log scan when the index is valid); old-unsaved history or a needing-rebuild index must have a clear state — never "finished loading".                                                                                         | Partial                                 | Cold valid-index projected pages, exact ancient-tool coverage and bounded read-byte tests pass; **frozen-source latency now measured** ([2026-09-12-frozen](benchmarks/2026-09-12-frozen.md)): cold valid-index tail p95 340.5 ms / 551.6 ms (100k/1k, ≤1 s met at the storage boundary), warm-owner 353.1 ms (≤200 ms unmet here), older page 184.4 ms (≤300 ms met); indexed-tail read bytes 200,733 / reads 212.1. **App-side generic pending/failure clear states render** (agent-loading / agent-timeline-sync-error+retry / agent-load-error+retry, never "finished loading"; `agent-timeline-sync-retry.spec.ts`). **Load-bearing app-side gap (ui lane):** `normalizeWorkspaceDescriptor` (`session-store.ts:135`) drops `authorshipStatus`, so the session-metadata "Metadata pending / needs rebuild" clear-state has no reachable UI surface in the rendered app — reported, not claimed Met. Rebuild/import UI states, real provider-free opens and production end-to-end latency remain.                                                                                                                                                                                                          |
| **AC5 — fast, correct scrolling**: keep the reading position when pages are added / avatars load / new output arrives; prefetch at most one page in the scroll direction, stopping on session change / history end / cache budget; paged-but-complete, including short pages.                                                                             | Partial (re-driving clean rendered run) | Real owner coverage/eviction/context-only tests pass; app directional prefetch and deferred refresh integrated. **Corrected 08:45 — OOM blocker subsided:** cgroup `oom_kill` still 3; the 12-test production-route scroll/anchor/paged-complete suite's run 3 daemon died at 08:32:21 from a clean `SIGTERM` (supervisor teardown) = the driving lane subagent was reaped under memory pressure, **not** an OOM kill of the daemon. The reproducible `Received: 2` lead is now **deterministically explained, not an OOM duplicate**: a clean load-independent probe (`probe-before-requests.spec.ts`, 1 passed 08:21, `/tmp/ui-ac5-probe.log`) shows the app fires **two** speculative `before`-direction prefetches on initial render (`paseo-prefetch:1:1` seq57, `:1:2` seq17) as the reading position settles across items — `viewed-timeline-sync.ts:435` → `TimelineDirectionalPrefetch.reading()` fires one per new near-start boundary. Runs 1–2 remain load-poisoned / invalid. Open adjudication: two-way speculative prefetch on initial load = over-prefetch vs "at most one page in the scroll direction" (app defect) or gate counts the wrong baseline (spec bug). Native/relay also Blocked. |
| **AC6 — bounded RAM**: daemon and app bound their cache by size, per session, and overall (counting index, subagents, hidden tabs); repeated open/close/scroll reaches a steady RAM state with a non-growing queue, measured separately from the provider process.                                                                                        | Partial                                 | Journal/store/file/retention budgets and focused owner tests exist; **whole-daemon steady state now measured** ([2026-09-12-frozen §Whole-daemon](benchmarks/2026-09-12-frozen.md)): 200 sessions × 204 rows through the shared 128-owner store, 6 cycles, owners bounded 128/128, post-GC RSS flat at ~336.6 MiB (0.5 MiB first→last growth), heap ~158 MiB, event-loop p95 16.9→16.1 ms, queue not growing, restart re-reads all 200 sessions + last tail. App/provider steady state, pending permission admission, all descriptor paths, long derived documents and disk allocation require remaining gates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **AC7 — fast, safe writes**: batched sequential append per journal with I/O tasks and queue bounded by bytes and overload handling; record replacement is atomic and "persisted" only after fsync; disk-full / write error is reported clearly — no fake success, no silent drop.                                                                         | Partial                                 | Canonical fsync, immutable queued rows, injected ENOSPC and actual child SIGKILL recovery tests pass. Final write amplification/event-loop/10-writer results and all transport/provider queues remain incomplete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **AC8 — full lifecycle**: migration / duplicate records / restart / retry–permission races / fork-with-file / delete-while-uploading / archive–restore with subagents + files all behave correctly; a session stays readable when the agent is not running or is archived.                                                                                | Partial                                 | Migration/rollback, duplicate ownership, subagent removal/restart, upload/fork leases, draft TTL, interrupted permanent deletion and current daemon/client retained WS/HTTP download pass. Rendered app download, all provider paths and cross-principal retry remain incomplete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **AC9 — compatibility**: Fusion↔Fusion (feature on/off), official app↔Fusion daemon, Fusion app↔official daemon, and a mixed multi-host list all work in the advertised scope; feature-off still reads; old-daemon rollback works.                                                                                                                        | Partial                                 | Actual isolated upstream merge and rollback CLI/old-source-reader checks completed. Four published official client/daemon/CLI combinations passed; official rendered app, mixed-host and production build combinations remain unverified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **W1 — Show/Hide**: independently toggle Created user / Channels / Updated user / Created time / Updated time in the existing menu and remember after app relaunch; a turned-off column returns its space to the rest; missing data drops the column — no fake person, no empty gap.                                                                      | Met-at-boundary (web)                   | Persisted independent Show/Hide state and row layout logic exist; **rendered web contract Met-at-boundary**: toggling createdUser/updatedUser/createdTime/updatedTime adds/removes the metadata-row columns with **no leading gap** (row filters nulls before joining) and the state is remembered after a cold `page.reload()` (`sidebar-session-metadata.ui-contract.spec.ts` test 1; **run 5 clean 4/4**, shots `w1-metadata-row-all-columns.png` + `w1-show-hide-remembered-after-reload.png`). The single run-4 flake was test 1's no-settle open hitting the same transient bottom-row clip as W6; the lane's `openSub` settle-wait (landed 06:42, post-run-4) makes it deterministic — run 5 confirms. Native rendering remains **Blocked** (no adb/Xvfb).                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **W2 — actor and time**: Created user/time = who/when the workspace was created; Updated user/time = who/when of the most recent chat or applied question/approve response; the two values always belong to the same interaction; provider output, retry, rename, or a record write must not change them.                                                 | Partial                                 | Durable summary ordering, replay, duplicate/retry and actor/time suppression tests pass. End-to-end interaction timestamps across every provider/automation path and recovery/delete races remain under review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **W3 — channel**: show the channel name from the recorded source of creation/interaction (usually one; several → one name + "+N", expandable); an app-created workspace is not assigned a channel by `cwd`; renaming keeps the link; the same name under a different connection/org/Hub stays distinguished; `/side` `/fork` place the channel correctly. | Partial                                 | Scoped channel snapshots and source propagation are implemented. Full channel rename/multiple-channel/fork placement transport proof remains incomplete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **W4 — readable time**: compact labels from the shared clock ("now", 5m, 2h, 3d, older → day); hover/detail shows the full date-time + timezone; self-updates while viewing without a per-row timer or waking the whole list each second.                                                                                                                 | Met-at-boundary (web)                   | Shared clock/formatter and full timestamp fields are implemented; **rendered web contract Met-at-boundary**: created/updated columns render compact labels matching `describeCompactTimeAgo` exactly; hover shows the full date-time + named timezone (locale-robust regex); the >7d static-tier row renders the real "Mon D" date (`sidebar-session-metadata.ui-contract.spec.ts` test 2; **run 5 clean 4/4**, shot `w4-compact-time-and-hover-full-date.png`). Self-update is the shared `relative-time-ticker` (no per-row timers); clock-tick behavior covered by its unit tests. Native rendering remains **Blocked**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **W5 — User filter**: filter workspaces the selected person created, chatted in, or gave an applied response to — not just the last person, so A is still findable after B takes over; several people = OR; people who merely share a name/ID at a different source are not merged.                                                                       | Partial                                 | Verified Member grouping and historical raw sender/member snapshots are tested; **rendered web sub-boundary Met-at-boundary**: multi-actor user filter — Alice remains findable after Bob takes over, OR-within across the user set, and clear-returns-all — passes on the production web export (`sidebar-session-metadata.ui-contract.spec.ts` test 3; **run 5 clean 4/4**, shot `w5-user-filter-multi-actor.png`). The initial red was attributed to a **spec** bug (the `toHaveCount(0)` "no Clear control yet" pre-check substring-matched the always-present "Clear filters" button), not a UI defect; fixed with `{ exact: true }`. Overall stays Partial: **full-lifecycle recomputation** (storage-owned; storage lane report silent on W5 — open, not environmental) and native rendering remain incomplete.                                                                                                                                                                                                                                                                                                                                                                                         |
| **W6 — Channel filter**: filter by the recorded channel link of a workspace; several channels in one filter = OR; User × Channel = AND; the selection persists across reload/host-change, with an active-filter indicator and a clear button even at zero results; no auto-clear just because a host is offline.                                          | Partial                                 | Metadata-only User/Channel OR-within/AND-across, persistence, strict pending metadata handling and clear-filter logic are tested; **rendered web sub-boundary Met-at-boundary**: channel filter OR-within / AND-across across the user filter, the zero-result "No workspaces match" empty state, and clear-still-reachable at zero results all pass on the production web export (`sidebar-session-metadata.ui-contract.spec.ts` test 4; **run 5 clean 4/4**, shots `w6-zero-result-empty-state.png` / `w6-zero-result-filter-clear-still-reachable.png` / `w6-channel-filter-active.png`). The initial red was attributed to a **spec** bug (the same "Clear filter" substring collision plus a transient viewport clip of the menu's bottom-most row, now handled by a settle-wait `openSub`), not a UI defect. Overall stays Partial: **rendered offline / mixed-host** controls (need a 2nd host; single-isolated-daemon harness can't produce it) and **no-auto-clear-on-offline** proof (store unit tests only) remain unverified; native rendering Blocked.                                                                                                                                            |
| **W7 — no history reads to build the list**: the daemon stores aggregate metadata (creator, last-interaction user/time, participating users, a channel reference) and the app does not open each history or call a profile per row to display/filter; new data updates through the existing directory-sync flow, restart restores it.                     | Partial                                 | Optional snapshot/cache fields, bounded startup inspection and demand recovery are tested; **frozen 10,000-session directory performance now measured** ([2026-09-12-frozen](benchmarks/2026-09-12-frozen.md)): session-layout load 27.09 s / 369 ops-s, warm aggregation p95 85.5 ms, legacy current 13.59 s vs baseline 2.32 s, migration 38 ms/op. Complete authorized restart/move/delete at scale and production recovery surfaces remain unverified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Focused validation

Commands use explicit test files/selections, `--bail=1 --maxWorkers=1`; no full suite
was run. Local `/tmp` logs are diagnostic evidence, not permanent CI artifacts.
Relevant test implementations remain in the changed source tree.

| Scope                                       | Passed checkpoint                                              | Evidence / boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout/journal independent review           | 18 tests, plus separate provider lookup regression             | `/tmp/session-storage-review-tests.log`, `/tmp/session-storage-provider-lookup-tests.log`. Actual child SIGKILL before log sync, after sync and before checkpoint rename; no power-loss/Windows guarantee.                                                                                                                                                                                                                                                                                                                                                                 |
| Summary recovery                            | 11 tests                                                       | `/tmp/session-recovery-stage8-tests.log`: empty startup, missing-index deferral, 64-entry queue, 130-session refill, viewed promotion and settlement demand.                                                                                                                                                                                                                                                                                                                                                                                                               |
| Authorship and archived permission RPC      | 9 selected, 149 skipped, 17.04 s                               | `/tmp/session-authorship-rpc-stage8-tests.log`. Helper/storage/RPC fixture evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Provider policy admission                   | 4 selected, 476 skipped, 12.25 s                               | `/tmp/session-provider-policy-stage9b-tests.log`: real manager/journal with fixture adapters, pending before forward and applied after acknowledgement, explicit system actor, cancellation distinction. OpenCode-specific call-site and broader provider coverage remain incomplete.                                                                                                                                                                                                                                                                                      |
| Mixed-source live permission generation     | 1 selected, 150 skipped, 15.69 s                               | `/tmp/session-generation-stage9-tests.log`; removes generation only for legacy outbound consumers without mutating the request.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Automation identity                         | Hub 5 tests / 4.02 s; enrolled daemon 1 selected / 39.12 s     | `/tmp/session-automation-hub-tests.log`, `/tmp/session-automation-daemon-tests.log`. Real daemon bootstrap/storage, fixture provider and in-memory Hub transport/access boundaries.                                                                                                                                                                                                                                                                                                                                                                                        |
| App retention/permission attempts           | 20 tests / 28.55 s                                             | `/tmp/session-retention-current-tests.log`; persistence/retry identity and retained-page logic, not native navigation.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Actual app owners                           | 2 selected / 24.80 s and 4 selected / 31.69 s                  | `/tmp/session-owner-context-tests.log`, `/tmp/session-retention-owner-followup.log`; cold/cache-painted context-only coverage, eviction and hidden admission.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Source-range regression                     | 100,001 canonical rows, 1 selected / 117.68 s                  | `/tmp/session-projection-ancient-tests.log`: old tool updated at sequence 100,001, exact ranges, canonical reads under 4 KiB and derived reads under 256 KiB. Tested checkpoint v2 before deferred v3; no current-v3 latency claim.                                                                                                                                                                                                                                                                                                                                        |
| App history/prefetch                        | 11 tests / 4.03 s; actual owner 3 selected / 27.31 s           | `/tmp/session-history-prefetch-tests.log`, `/tmp/session-owner-prefetch-tests.log`; cancellation, adjacent prefetch and late-response discard. Deferred rendering and reading-anchor restoration remain pending.                                                                                                                                                                                                                                                                                                                                                           |
| App subagent/filter/readiness               | 31 tests / 2.45 s; reducer 11 selected / 1.66 s                | `/tmp/session-app-subagent-permission-tests.log`, `/tmp/session-live-source-reducers.log`; parent budget, hidden broadcasts, strict filters and monotonic status.                                                                                                                                                                                                                                                                                                                                                                                                          |
| File lifecycle/download/subagents           | 23 tests / 9.77 s; resource authorizer 1 selected / 2.32 s     | `/tmp/session-file-lifecycle-tests-stage8.log`, `/tmp/session-file-download-authorizer-tests-stage8.log`. Real file/token owners, fixture download resolver; not actual HTTP/app download.                                                                                                                                                                                                                                                                                                                                                                                 |
| Lifecycle follow-up                         | 20 tests / 12.24 s                                             | `/tmp/session-file-lifecycle-followup-tests.log`: image-link failure/TTL, token limits, actual fork path and child SIGKILL after deletion intent/between removals.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Permanent Session delete ordering           | 1 selected, 149 skipped, 15.53 s                               | `/tmp/session-delete-entrypoint-tests.log`: actual handler, injected failure after first destructive action, then fresh storage recovery. Separate from child-process crash test; not a killed live WebSocket daemon.                                                                                                                                                                                                                                                                                                                                                      |
| Deferred documents through actual FileStore | 6 tests / 47.19 s                                              | `/tmp/session-derived-document-store-tests.log`: >1 MiB merged reply, 140 disjoint ancient-tool ranges and growing metadata, immutable snapshots, UTF-8/bounded pages, missing derived payload recovery and subsequent append, legacy opt-out error. Not a renderer or performance acceptance result.                                                                                                                                                                                                                                                                      |
| Hidden configured home upload               | 1 selected, 5 skipped, 2.78 s                                  | `/tmp/session-hidden-home-upload-tests.log`; actual FileUploadStore uses `.paseo`, reproducing and fixing a failure found by the published-client matrix.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Subagent admission and canonical payload    | 4 tests / 5.70 s                                               | `/tmp/session-subagent-admission-stage11-tests.log` (Sep 12): 64 KiB descriptor and 4 MiB current-parent admission before publication, immutable queued snapshots, failed-save recovery, full >64 KiB tool output and deferred document.                                                                                                                                                                                                                                                                                                                                   |
| Document RPC source and resource scope      | 1 selected, 151 skipped, 13.49 s                               | `/tmp/session-document-scope-stage11-tests.log` (Sep 12): actual Session/authorizer with fixture store calls; archived owner access, denied parent, foreign child, incapable source suppression and source-targeted responses. Not an actual HTTP or WebSocket payload transfer.                                                                                                                                                                                                                                                                                           |
| Cwd and deletion lifecycle                  | 15 tests / 3 files / 10.02 s                                   | `/tmp/session-lifecycle-stage12-tests.log` (Sep 12): canonical cwd continuity, rollback/legacy cwd move, ambiguous ownership rejection,32 completed deletion owners, fresh-owner resurrection fence and interrupted deletion. Includes file activity tests.                                                                                                                                                                                                                                                                                                                |
| Mutable storage boundaries                  | 2 selected / 3.18 s                                            | `/tmp/session-storage-mutable-stage12c-tests.log`: immediate upsert mutation stays out of memory/disk; descriptor get/list/event snapshots cannot mutate admitted cache entries. Initial upsert test exposed cloning after the first await; fixed.                                                                                                                                                                                                                                                                                                                         |
| Deferred compaction and unknown snapshot    | 1 selected / 2.86 s; 1 selected / 3.70 s                       | `/tmp/session-compaction-stage12-tests.log`, `/tmp/session-document-rebuild-stage12-tests.log`: oversized unknown compaction metadata remains in full document with bounded preview; unknown snapshot does not rebuild, known missing payload recovers and subsequent append succeeds.                                                                                                                                                                                                                                                                                     |
| Retained download transport                 | 1 test / 37.01 s                                               | `/tmp/session-download-transport-stage12c-tests.log`: current daemon/client real WS upload and agent-scoped token, archive and capture-off restart, HTTP byte download, single-use token, unsent/foreign/traversal/forged rejection and legacy workspace path. Client explicitly advertises the session-read capability; this is not rendered app or multi-principal authentication proof.                                                                                                                                                                                 |
| Failed cancellation cleanup                 | 3 selected / 2.34 s                                            | `/tmp/session-delete-cancellation-stage12-tests.log`: synchronous and asynchronous cancellation failures release idle owners, plus registration-vs-delete race. Active cancellation failures remain retryable and are not silently forced through deletion.                                                                                                                                                                                                                                                                                                                |
| Identity follow-up                          | capture-off1; queue2; recovery/read4; ACP2; exact tool cursor1 | `/tmp/session-rolloutoff-regression.log`, `/tmp/session-identity-queue-tests.log`, `/tmp/session-identity-recovery-tests.log`, `/tmp/session-identity-acp-tests.log`, `/tmp/session-identity-anchor-tests.log`; final selected gates passed (reported by identity owner). Fixture providers remain explicit.                                                                                                                                                                                                                                                               |
| Derived allocation probe                    | 1,000 rows / 64.26 s                                           | `benchmarks/2026-09-12-derived-allocation.json`, `benchmarks/2026-09-12-derived-reachability.json`: 15,919 node files / 8,032,569 logical bytes / 67,215,360 allocated bytes including directory. Current roots reach1,830nodes/608,483B; persisted journal revision roots reach2,749nodes/1,071,788B; all663snapshot roots reach9,392nodes/4,367,160B. Only6,527nodes/3,665,409B are unreachable from any snapshot (4,721field-map,1,779sequence,27branch). Current-unreachable historical snapshots are not automatically garbage. Per-operation origin is not recorded. |

Current queued gates include production browser rendering, full native/relay
coverage, independent multi-principal upload retry, and a frozen benchmark after
all source changes. Source authored after a passed checkpoint
is not covered by that older result.

The isolated browser component harness passed four interaction/field tests, using
explicit Vite/native stubs. Its screenshot is largely unstyled and does **not**
validate the real workspace shell, spacing, avatar layout, profile-tab integration
or native behavior. Actual Metro route attempts failed before assertions (cold
warmup timeout near completion and a subsequent RAM-pressure interruption).
Production export/browser measurements and native/desktop checks remain absent.
No adb/emulator/Xvfb was available in the inspected environment.

## Benchmarks and compatibility artifacts

- [Frozen-source benchmark report](benchmarks/2026-09-12-frozen.md) and
  [unedited measurements](benchmarks/2026-09-12-frozen.json): the same dataset set on a
  **byte-stable** source (HEAD `3e4df80f4` + uncommitted changes, fingerprints recorded
  at start and end, 28/28 phases, exit=0, 38m26s). Companion probes on the same source:
  [derived allocation](benchmarks/2026-09-12-derived-allocation-frozen.json) and
  [AC9 rollback reverse-conversion](benchmarks/2026-09-12-rollback.json). This supersedes
  the 2026-09-11 diagnostic for the storage boundary; it is still the daemon
  store/read/write boundary only, not production web/desktop end-to-end.
- [Diagnostic benchmark report](benchmarks/2026-09-11-diagnostic.md) and
  [unedited measurements](benchmarks/2026-09-11-diagnostic.json): 1,000/10,000 session
  records, 1,000/100,000 mixed canonical rows, ten writers, repeated 160-owner opens.
  Node 22.23.2/Linux/overlayfs, warm kernel cache, source changed during execution;
  the worker retained earlier projection/metadata code. An accidental overlapping
  type-aware lint process competed for approximately 20 seconds during the writer
  phase. Every sample was retained. This is diagnostic, **not final acceptance**.
- Observed diagnostic ten-writer result: 10,000 rows in 339.66 s (29.44 rows/s),
  acknowledgement p95 586.73 ms, 193,371 fsync calls, 590,766,080 physical write bytes
  for 2,665,180 logical bytes. Final rerun must measure derived node counts and
  allocated disk bytes as well as throughput, queues, event-loop, heap/RSS and read
  bytes. New document node files may add substantial allocation amplification.
- [Actual dirty-snapshot merge report](benchmarks/2026-09-11-upstream-rehearsal.json):
  isolated snapshot `fce90c018514e4cf935644258ca5d7474ef6f7e8` against upstream
  `fa93c4290eaa87ae58452ab6e2012f85ae6e0c6b`, 55 conflicts. Root branch/index unchanged;
  source did not change after snapshot. Temporary worktree:
  `/tmp/session-storage-upstream-rehearsal-stage9`.
- [Baseline actual Git merge-tree output](benchmarks/2026-09-11-upstream-baseline-merge-tree.txt)
  for HEAD `3e4df80f43ad78218486ac1b3414f98fc71c6b17` against the same upstream has
  45 conflicting paths, all also present in the dirty snapshot. Ten additional
  paths: sidebar empty states, directory sync, replica tests, session stream
  reducers, viewed timeline sync, daemon client, client capabilities, agent prompt,
  timeline projection and operation permissions. This classifies merge surfaces,
  not semantic blame or compiled behavior of a resolved merge.
- [Actual rollback report](benchmarks/2026-09-11-rollback.json): the rollback CLI
  retained original record bytes including a future field, uploads and epoch/journal
  bytes; the HEAD legacy AgentStorage source returned one record. Shared installed
  dependencies were reused. This is not a packaged old daemon/browser launch.
- Published official 0.8.0 artifacts are staged outside this checkout with tarball
  SHA-512 verification and separate registry gitHead metadata. Third-party
  dependencies are shared with this workspace, so the runtime remains diagnostic.
  All four actual-artifact selections passed across final runs: official client→Fusion
  capture off (`/tmp/session-official-matrix-stage10b-tests.log`), official client→Fusion
  capture on and Fusion client→official daemon (`/tmp/session-official-matrix-stage10d-tests.log`),
  and official CLI→Fusion (`/tmp/session-official-cli-stage11-tests.log`, 1 selected,
  3 skipped, 50.96 s). Official 0.8.0 registry gitHead is
  `b8e24677e12b226c7c38c1c3a40649daa9f1152f`. The initial capture-on upload exposed
  the hidden-home runtime bug above; later retry fixes corrected the test
  acknowledgement API and inherited PASEO_AGENT_ID fixture environment. These
  verified tarball runs share third-party dependencies and use guarded fixture
  providers. They do not establish a rendered official-app or real-provider matrix.

## Remaining work and limits

- Complete remaining source/test/lint/type gates and typed document RPC transport
  checks; retained download transport now has a current daemon/client proof. Keep
  validation tied to exact source/build fingerprints.
- Verify durable main provider/hydration paths preserve full canonical content;
  their historical 64 KiB display limiter must not truncate the journal. Two real
  manager/provider-journal regressions passed in 4.18 s
  (`/tmp/session-manager-full-content-tests.log`), including reopen and slow admission.
  Full durable subagent preservation also passed its actual store/document test
  (`/tmp/session-subagent-admission-stage11-tests.log`) and descriptor read-snapshot
  mutation selection (`/tmp/session-storage-mutable-stage12c-tests.log`); provider-
  specific native histories and the complete transport matrix remain separate work.
- Complete deferred app rendering, exact descriptor refresh/coverage, bounded
  document navigation and cancellation, permission history, and directional prefetch.
- Retain the Sep 12 reachability probe as diagnostic evidence for future performance
  work. It found 15,919 historical files and 67.22 MB allocated for 8.03 MB logical
  derived data at 1,000 rows; 1,830 current-root nodes (608,483B) were reachable,
  all snapshot roots retained 9,392 nodes/4,367,160B, and 6,527 nodes/3,665,409B
  were unreferenced intermediate path-copy nodes. Derived format and collection
  changes are outside this lane; no 100,000-row acceptance claim is made.
- Finish global/per-session accounting across providers, pending permission
  responses, retained descriptors, cancellation/failure owners and concurrent file
  operations. The whole-daemon steady state is now measured at a fixed sequential load
  ([2026-09-12-frozen §Whole-daemon](benchmarks/2026-09-12-frozen.md): 128/128 owners
  bounded, post-GC RSS flat at ~336.6 MiB, queue not growing, restart re-reads); the
  store-only LRU measurements no longer are the only evidence. App/provider-side
  retention and a production packaged daemon remain unmeasured.
- Fork attachment admission currently explicitly rejects more than 256 linked
  files or 1 MiB descriptor metadata. TTL remains bounded in memory but can scan
  links repeatedly for many expired drafts; unknown legacy files are retained.
  Failed file-delete cancellation can retain a deleting owner until retry. These
  are visible limits/gaps, not silently truncated success.
- The frozen, interference-free benchmark comparison is done
  ([2026-09-12-frozen](benchmarks/2026-09-12-frozen.md)); the ≤200 ms cached target is
  unmet at the storage boundary, so production web/desktop timing (especially the cached
  target) still has to be measured on a production host. Remaining: production
  web/native/desktop/relay checks, Resolve/test the actual upstream merge, and the
  official artifact + rendered app compatibility matrix (the 2026-09-12 rollback probe
  used shared installed dependencies, not a packaged old daemon).
- App/rendered side (ui lane, `lane-ui-route-evidence.md`): W1/W4 are Met-at-boundary
  (web) on the production static export (run 5 clean 4/4, `/tmp/ui-sidebar-meta-run5.log`);
  W5/W6 and AC2 are Met-at-boundary (web) for their rendered sub-boundaries but remain
  Partial overall (W5 full-lifecycle recomputation; W6 offline/mixed-host + no-auto-clear
  on host offline; AC2 keyboard/touch open variants). AC4 app-side: generic pending/failure
  clear states render, but the session-metadata "pending/needs-rebuild" clear-state is
  unreachable because `normalizeWorkspaceDescriptor` drops `authorshipStatus`. Still
  pending on the ui lane: AC5 production-route scrolling/viewport anchoring
  (`agent-timeline-pagination.spec.ts`, run in flight), AC6 app-side steady-state RSS
  (app process sampled separately from the daemon), AC3/AC9 chat-against-a-no-metadata
  host and true mixed-host list (both need a 2nd host — single-isolated-daemon harness),
  and AC8 rendered download (recorded as not-proven on this lane). Native/relay remain
  Blocked (no adb/Xvfb/relay checkout).

## Iteration: durable timeline, fast jump, restart-safe tool approval (2026-09-14)

Point-by-point status lives in
[iterations/2026-09-13-acceptance-matrix.md](iterations/2026-09-13-acceptance-matrix.md). This section records what
changed and what was measured.

### Scope

Two halves on one substrate. The durable timeline and fast jump are described below; the second
half makes **tool approval survive a mid-flight daemon restart** — a response is journalled
`pending` before it reaches the agent tool, `PermissionResponseAdmission` refuses to forward an
id that already has a record, the submission ledger refuses to re-run a `clientMessageId` that
was already admitted, and a status change keeps the original responder, timestamp and order.
Both halves share one `events.jsonl`, one writer lock and one `operationOrder`, which is what
keeps message and approval ordering correct after recovery.

### What changed

`SessionEventLog` (`session-event-log.ts`) is now the whole durable session: one
`events.jsonl` carrying `timeline`, `submission` and `permission` records, and one
`events.index.json` holding every derived fact — byte pointers per `kind:seq`, user-message
anchors, id lookups (`client`, `provider`, `submission`, `permission`, `tool`) and the
authorship checkpoint. `session-event-index.ts` owns the index shape and how each persisted
line is folded into it, so append and rebuild share one code path.

These are gone: the `projection/`, `permissions/`, `submissions/` and `index/messages/`
folders, `authorship.index.json`, `submissions.index.json`, `responses.index.json`, the
`by-id/` buckets, and the `derived-document` / `derived-field-map` /
`projected-entry-document` / `journal-id-index` modules. A session that predates the
iteration is imported once from its segmented journals on first durable read, keeping its
epoch and sequence.

`ProjectedTimeline` (`projected-timeline.ts`) replaces the persisted derived index.
Projection is now a pure function of canonical rows. A page reads only the rows that can
reach it: the requested span, widened at each edge while a neighbouring row can merge, plus
the remaining rows of any tool call in the window resolved by canonical id. That window
projects to the same entries as projecting the whole history, which the golden test asserts
directly. Deferred payload and source-range descriptors are derived (`sha256(epoch:seqStart:seqEnd)`)
rather than stored, so a descriptor cannot go stale against a live log.

Two performance corrections fell out of the cutover:

- The index is checkpointed (`scannedBytes` plus a 64-row / 256 KiB threshold), not rewritten
  per append. Rewriting a per-row pointer map on every append costs `O(rows²)` bytes; the
  400-chunk journal-size test dropped from 15.9 s to 4 s once it was checkpointed. Load folds
  in whatever the tail added past the last checkpoint, so a crash costs a bounded rescan.
- `AgentManager.hasStoredTimeline` still probed `events-000001.*`. A canonical session
  therefore fell back to the in-memory timeline on read.

Client side, `readTimelinePayload` and `readTimelineSourceRanges` now refuse to send unless
the connected daemon advertises `agentSessionStorageRead`, matching the rule that a new
request needs its own capability bit and a test against a host without it.

### Evidence

| Gate                                                                                     | Result                                         |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `npm run typecheck` (workspace)                                                          | pass                                           |
| `session-storage` suite (10 files)                                                       | 64 passed, 1 skipped (the opt-in 100k ceiling) |
| `agent-manager.test.ts`                                                                  | 180 passed                                     |
| coalescer + manager stream coalescing                                                    | 52 passed                                      |
| `official-session-storage-matrix`, session-file maintenance, provider-subagent admission | 7 passed, 4 skipped                            |
| `daemon-client.test.ts` capability matrix                                                | 7 passed                                       |
| lint on changed files                                                                    | clean                                          |

`iteration-acceptance.test.ts` is the new acceptance file: the three-file layout, the
journal-size comparison against the quadratic form, prompts listed from anchors with zero
`events.jsonl` bytes read, a jump to a message outside the last page after a cache-dropped
restart, rebuild-and-jump with a deleted and with a corrupt index, and preview/seq stability
while a turn keeps streaming.

### Limits

- The 100,000-row ceiling diagnostic runs only under `PASEO_SESSION_STORAGE_CEILING`
  (harness: `--ceiling`). It completed in 291 s — inside the contract's cap — reading
  365 KB of `events.jsonl` for a cold tail page. It stays optional regardless.
- `paged-journal.ts` survives only to import pre-canonical sessions. Its write path and the
  crash-recovery tests around it no longer cover a production code path and should be reduced
  to a reader.
- App, native, relay and real-provider behaviour are unchanged by this iteration and are not
  re-proven here.
