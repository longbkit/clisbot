# Goal-wide AC/W evidence matrix — agent-session-storage

> Historical record of the 2026-09-12 campaign. Current state: [implementation.md](../implementation.md).

**Owner:** coordinator. **Date:** 2026-09-12.
**Purpose:** single source of truth mapping every AC1–AC9 / W1–W7 to its code path,
existing test evidence, missing evidence, limits, and owning lane. Every lane subagent
reconciles its work against this table and **must not** conclude a criterion is met
without matching the boundary it claims.

**Contract:** the approved acceptance contract is
[README.md](README.md) (AC/W definitions + "Evidence required").
[Evidence log](../implementation.md) records what has actually passed.
This matrix joins the two: _what must be true_ (README) vs _what is proven_ (implementation.md).

**Lanes (three subagents):**

- `storage_plan_rebuild` — storage / lifecycle / benchmark. Primarily **AC4, AC6, AC7, AC8, W7** (+ AC3/AC9 storage-compat).
- `gate1_auth_compat` — identity / authorship / authorization / provider / compatibility. **AC1, AC8, W2, W3, W5, W6** (+ provider part of AC1/AC8, all of AC3/AC9).
- `ui_route_evidence` — app / timeline / rendered validation. **AC2, AC4, AC5, AC6** (+ W1, W4, W5, W6).

A criterion appears in every lane that must produce evidence for it; the **owning lane**
(named in **Lane**) is accountable for closing it. Cross-lane rows are marked
`<lane>` so no lane silently assumes another's proof.

Legend — Evidence: `impl §` = implementation.md line. Boundary: the exact artifact/flow
that proves the criterion; "static" = code/test exists but no rendered/live/perf proof.

---

## A. Agent session criteria

### AC1 — correct sender

- **Must be true (README §AC1):** every `user_message` with `sender.kind=user` shows
  name/avatar when present; missing name → use ID; broken/missing avatar still readable.
  A/B alternating keep the right person per message across retry, reopen, restart; no two
  people merged into one author group. Coverage: app, direct channel, Automation (identity
  rules). question/approve responses keep a distinct responder.
- **Code path:** `session-authorship.ts` (scoped actor snapshots),
  `message-submissions.ts` (clientMessageId admission + same-id/different-content reject),
  `permission-response-journal.ts` (respondedBy + pending/applied),
  `permission-generation-projection.ts` (legacy outbound consumers keep no generation),
  hub `channels/daemon/session-operation.ts` + `managed-access/session-operation-tickets.ts`
  (per-operation trusted identity tickets), `managed-access/automation-session-identity.ts`.
- **Existing tests (impl §):** scoped actor schemas, trusted operation admission, message
  conflicts, permission snapshot/generation, cached authorship round-trips; Hub 5 tests +
  enrolled-daemon 1 for automation identity; provider policy admission 4 selected (fixture
  adapters, pending-before-forward / applied-after-ack, explicit system actor, cancellation
  distinction); identity follow-up capture-off / queue / recovery / ACP / exact-tool-cursor.
- **Missing evidence (boundary to close):**
  - Real Hub access-store + real channel + **real provider** A/B alternation rendered
    (today fixture providers only).
  - **Cross-principal upload retry** (independent multi-principal, impl "Remaining").
  - **Rendered author grouping** in the app (not just cached round-trip).
- **Limits:** fixture-provider evidence is explicitly not real-provider; rendered proof
  absent. No full Hub/channel/provider alternation yet.
- **Lane:** `gate1_auth_compat` (owns). `ui_route_evidence` proves the rendered grouping.
  `storage_plan_rebuild` proves durable re-read of sender after restart (feeds AC1 reopen).

### AC2 — profile in a tab

- **Must be true:** hover name/avatar shows ID; click opens a read-only profile tab in the
  current workspace using the existing tab architecture (name, avatar, ID, source/scope,
  linked Member if any). Re-click same identity reopens that tab; same ID under a different
  Hub/org/channel-connection must not open the wrong person. Tolerates no-link / no-profile.
  Tab close/open/restore + returning to chat preserves draft and reading position. Touch +
  keyboard also open it (no hover dependency).
- **Code path:** `packages/app/src/clisbot/session-storage/{profile-panel.tsx, actor.tsx,
permission-snapshot-inspector.tsx}`, app tabs model (`workspace-tabs`),
  `use-reading-anchor.ts`, composer draft (`composer/draft/workspace-tab.tsx`).
- **Existing tests (impl §):** profile scope/identity, fields, component interaction tests
  (isolated browser harness, 4 interaction/field tests, Vite/native stubs).
- **Missing evidence (boundary):** **actual workspace route** (real shell, spacing, avatar
  layout, profile-tab integration); keyboard/touch/native navigation; **draft and
  reading-position preservation** on tab close/restore; native behavior. Current harness
  screenshot is "largely unstyled" and does **not** validate the real workspace shell.
- **Limits:** Metro route attempts failed before assertions (cold warmup timeout + a later
  RAM-pressure interruption). No adb/emulator/Xvfb in the inspected environment.
- **Lane:** `ui_route_evidence` (owns).

### AC3 — older history

- **Must be true:** messages lacking `sender` keep the old display, no fake avatar/sender.
  Old session that receives a new message with metadata → only the new message shows the
  author. App meeting an official (no-metadata) daemon can still chat/read history;
  profile/avatar never blocks opening a conversation.
- **Code path:** optional `sender`/`respondedBy`/`createdBy` fields; legacy reconciliation
  preserving unknown authors; default-off + old parser paths;
  `recover-session-authorship.ts`; official matrix test
  `official-session-storage-matrix.test.ts`.
- **Existing tests (impl §):** optional fields + legacy reconciliation preserve unknown
  authors; default-off and old parser covered; **four published-artifact API/CLI
  combinations passed**.
- **Missing evidence (boundary):** a **rendered official app** is not represented by the
  client package — the matrix proves the wire/CLI, not the rendered official UI.
- **Limits:** published artifacts share third-party deps → runtime diagnostic; guarded
  fixture providers; not a rendered official-app or real-provider matrix.
- **Lane:** `gate1_auth_compat` (owns). `ui_route_evidence` proves the app side of
  "no-metadata still reads". `storage_plan_rebuild` proves the legacy reader path.

### AC4 — fast open

- **Must be true:** with saved history, first open reads/returns only the nearest page +
  needed index; no provider init or full-log scan when the index is valid. Reuse the 40-item
  merged page (≠ 40 JSONL lines). A valid cache may paint immediately then reconcile.
  Old-unsaved history or a needing-rebuild index must have a clear state; do not call it
  "finished loading".
- **Code path:** `projected-timeline-index.ts` + `read-journal-page.ts` (cold valid-index
  pages), `projected-entry-document.ts` / `derived-document.ts` (exact ancient-tool
  coverage), bounded read-byte reads, app `timeline-page-retention.ts` /
  `timeline-retention-owner.ts`.
- **Existing tests (impl §):** cold valid-index projected pages, exact ancient-tool
  coverage, bounded read-byte tests pass; source-range regression (100,001 canonical rows,
  canonical reads <4 KiB, derived <256 KiB); a diagnostic benchmark exists.
- **Missing evidence (boundary):** **frozen-source latency** (current checkpoint v3 — the
  100k test was v2, "no current-v3 latency claim"); **rebuild/import UI states**;
  **real provider-free open** end-to-end; production p95 numbers (click→last-page ≤1s
  cold-index, ≤200ms cache, ≤300ms scroll — all _targets, unmeasured_).
- **Limits:** diagnostic benchmark ran with source changing mid-run + a competing lint
  process; not final acceptance.
- **Lane:** `storage_plan_rebuild` (daemon read boundary, owns the frozen benchmark).
  `ui_route_evidence` proves the app-side page/rebuild/import UI state.

### AC5 — fast, correct scrolling

- **Must be true:** reuse virtualization; keep the reading position when pages are added,
  avatars load, or new output arrives. Prefetch at most one page in the scroll direction;
  stop on session change / history end / cache budget. Do not auto-load to the top on a
  cursor change. Keep the paged/complete contract (timeline-sync §"gap recovery is paged
  but complete"), including short pages not filling the viewport, tool updates, epoch change.
- **Code path:** `strategy-web.tsx` / `strategy-native.tsx` (virtualization),
  `use-reading-anchor.ts` (viewport anchor), `timeline-directional-prefetch.ts`
  (directional prefetch), `deferred-timeline-item.tsx` + deferred refresh
  (authoritative projected refresh, not local merge).
- **Existing tests (impl §):** real owner coverage/eviction/context-only tests pass; app
  directional prefetch + deferred refresh **being integrated**; history/prefetch 11 tests
  (cancellation, adjacent prefetch, late-response discard) + actual owner 3 selected.
- **Missing evidence (boundary):** **production route scrolling**, **viewport anchoring**,
  **native/relay behavior**; deferred rendering + reading-anchor restoration still pending.
- **Limits:** no production route / native proof; no relay.
- **Lane:** `ui_route_evidence` (owns).

### AC6 — bounded RAM

- **Must be true:** both daemon and app bound cache by size, per session, and overall;
  counting index, subagent, and hidden tabs. Evict least-used persisted pages; keep the
  read region + in-flight submit/write state in separate limits. Reopen by page; no lost
  pending, no duplicate messages, no certifying a cursor for a dropped range. Restart does
  not load all history. Long runs / opening many sessions in turn must not retain full
  history; measure Paseo RAM separately from the provider process.
- **Code path:** `timeline-retention.ts` / `pending-event-budget.ts` (daemon budgets),
  app `timeline-page-retention.ts` / `timeline-retention-owner.ts` /
  `subagents/timeline-retention.ts` (parent/global retained-page budgets, subagent projected
  page ownership), `derived-document.ts` (bounded derived).
- **Existing tests (impl §):** journal/store/file/retention budgets + focused owner tests;
  app owner tests (cold/cache-painted context-only coverage, eviction, hidden admission);
  subagent/filter/readiness 31 tests (parent budget, hidden broadcasts).
- **Missing evidence (boundary):** **whole-daemon / app / provider steady state** under a
  fixed budget; pending-permission admission; all descriptor paths; long derived documents;
  disk allocation; repeated open/close/scroll must reach a **steady RAM state** with a
  non-growing queue at the published load (impl "store-only LRU measurements do not
  establish whole-daemon bounded memory").
- **Limits:** derived node files add allocation amplification (1,000 rows → 15,919 files /
  67.2 MB allocated for 8.03 MB logical). No whole-process steady-state proof yet.
- **Lane:** `storage_plan_rebuild` (daemon steady state, owns). `ui_route_evidence`
  (app steady state). `gate1_auth_compat` (pending-permission admission path).

### AC7 — fast, safe writes

- **Must be true:** batched append, sequential write per journal; bounded total I/O tasks
  and queue by bytes, with overload handling, no event-loop blocking, no rewriting the whole
  conversation per chunk. Record replacement is atomic; "persisted" only after fsync to
  disk. Disk full / write error must report clearly — no fake success, no silent drop.
  Crash mid append/rename/rotate keeps acknowledged data; an incomplete tail recovers
  safely; a mid-file corrupt section is not skipped. A lost/drifted index must rebuild.
- **Code path:** `paged-journal.ts` (append + sequential commit), `durable-file.ts`
  (fsync + dir sync + atomic replace), `journal-id-index.ts` (rebuildable index),
  `projected-document-store.ts` (immutable node files, compaction),
  `permission-response-journal.ts`.
- **Existing tests (impl §):** canonical fsync, immutable queued rows, injected ENOSPC, and
  **actual child SIGKILL** recovery (before/after log sync, before checkpoint rename) pass;
  deferred compaction + unknown-snapshot tests; source authored after a passed checkpoint is
  not covered by it.
- **Missing evidence (boundary):** **final write amplification / event-loop / 10-writer**
  results; **all transport/provider queues**; power-loss / Windows guarantee explicitly
  absent; derived-node **disk allocation** as an acceptance number (currently a diagnostic
  probe).
- **Limits:** 10-writer diagnostic: 10,000 rows / 339.66 s (29.44 rows/s), ack p95 586.73 ms,
  193,371 fsync calls, 590.8 MB physical writes for 2.67 MB logical. A rerun must measure
  derived node counts + allocated bytes alongside throughput/queues/event-loop/heap/RSS/read
  bytes.
- **Lane:** `storage_plan_rebuild` (owns).

### AC8 — full lifecycle

- **Must be true:** verify migration / duplicate record, restart, retry / permission race,
  rewind / missing ID, fork-with-file, delete-while-uploading, archive/restore with
  subagent/file. Readable when the agent is not running or is archived; do not infer a
  tool/process is still alive from history.
- **Code path:** `layout.ts` + `session-location` (cwd continuity / rollback / legacy move /
  duplicate rejection), `deletion-intents.ts` (intent-then-fence/drain/remove + startup
  completion), `agent-storage.ts` migration (preserves unknown fields, rejects conflicting
  copies), `file-upload/session-files.ts` + fork lease, `provider-subagents/persistence.ts`,
  `rollback-session-layout.ts`.
- **Existing tests (impl §):** migration/rollback, duplicate ownership, subagent
  removal/restart, upload/fork leases, draft TTL, interrupted permanent deletion, current
  daemon/client retained WS/HTTP download pass; cwd + deletion lifecycle 15 tests; repeat-
  delete/fresh-owner + scoped-intent recovery regressions; failed-cancellation cleanup.
- **Missing evidence (boundary):** **rendered app download**; **all provider paths**;
  **cross-principal retry**; FileStore's separate deleting-ID owner "remains under lifecycle
  review"; failed file-delete cancellation can retain a deleting owner until retry.
- **Limits:** a disk fence remains; fork attachment rejects >256 linked files or >1 MiB
  descriptor metadata (visible limit, not silent truncation).
- **Lane:** `storage_plan_rebuild` (owns lifecycle + fork/delete/upload). `gate1_auth_compat`
  (cross-principal retry). `ui_route_evidence` (rendered download).

### AC9 — compatibility

- **Must be true:** verify Fusion app ↔ Fusion daemon on/off; official app ↔ Fusion daemon
  with Managed Access off; Fusion app ↔ official daemon; and a mixed multi-host list. Create
  workspace/session, send message/file, approve, paginate, reconnect, and old CLI all work
  in the advertised scope. Feature-off still reads the created layout; old-daemon rollback
  needs its own reverse-conversion path.
- **Code path:** `features.agentSessionStorage` (capture, default off) +
  `features.agentSessionStorageRead` (retained durable reads incl. rollout-off sessions);
  `CLIENT_CAPS.agentSessionStorage` gates new read shapes; `official-session-storage-
matrix.test.ts`; `rollback-session-layout.ts`; upstream merge rehearsal script.
- **Existing tests (impl §):** isolated upstream merge + rollback CLI / old-source-reader
  checks done; **four published official client/daemon/CLI combinations passed** (official
  0.8.0, tarball SHA-512 verified, registry gitHead `b8e24677…`).
- **Missing evidence (boundary):** **official rendered app**, **mixed-host**, **production
  build** combinations; a packaged old daemon/browser launch (rollback proof is source-level,
  not packaged).
- **Limits:** published runs share third-party deps + guarded fixture providers; do not
  establish a rendered official-app or real-provider matrix.
- **Lane:** `gate1_auth_compat` (owns the compatibility matrix). `storage_plan_rebuild`
  (rollback reverse-conversion). `ui_route_evidence` (rendered official-app / mixed-host).

---

## B. Workspace-list criteria

### W1 — Show/Hide

- **Must be true:** independently toggle **Created user, Channels, Updated user, Created
  time, Updated time** in the existing menu; remember after app relaunch. Turning a column
  off returns its space to the rest. Missing data → drop the column, no fake person / empty
  gap; does not change filter/permissions.
- **Code path:** `sidebar/display-preferences/{menu.tsx, model.ts, row-items.ts}`,
  `stores/sidebar-view-store.ts`, `clisbot/session-storage/workspace-metadata-row.tsx`.
- **Existing tests (impl §):** persisted independent Show/Hide state + row layout logic.
- **Missing evidence (boundary):** actual **styled shell / no-gap** and **native rendering**.
- **Lane:** `ui_route_evidence` (owns).

### W2 — actor and time

- **Must be true:** Created user/time = who/when the workspace was created. Updated
  user/time = who/when of the **most recent chat or applied question/approve response**,
  aggregated over the workspace's sessions. The two values always belong to the same
  interaction; no interaction → empty. Provider output, retry, rename, or a record write
  must not change this; do not substitute the record's technical `updatedAt`.
- **Code path:** `session-summary.ts` (durable summary ordering + replay + actor/time
  suppression), `agent-projections.ts`, `session-authorship.ts` (last accepted message /
  last applied permission response carry durable ordering metadata).
- **Existing tests (impl §):** durable summary ordering, replay, duplicate/retry, and
  actor/time suppression tests pass.
- **Missing evidence (boundary):** end-to-end interaction timestamps across **every
  provider/automation path**; recovery/delete races "remain under review".
- **Lane:** `gate1_auth_compat` (owns aggregation semantics). `storage_plan_rebuild`
  (recovery/delete races). `ui_route_evidence` (rendered).

### W3 — channel

- **Must be true:** show the channel name from the recorded source of creation/interaction
  (usually one; several → one name + `+N`, expandable to the full list). An app-created
  workspace is not assigned a channel by `cwd`. Renaming a channel keeps the link; the same
  name under a different connection/org/Hub is still distinguished. `/side`, `/fork` in the
  same workspace keep the workspace's channel info; they do not create a new send/receive
  binding.
- **Code path:** scoped channel snapshots + source propagation (`session-authorship.ts`,
  `session-summary.ts`), channel key `(hubOrigin, organizationId, connectionId, channelId)`.
- **Existing tests (impl §):** scoped channel snapshots + source propagation implemented.
- **Missing evidence (boundary):** full **channel rename / multiple-channel / fork
  placement** transport proof.
- **Lane:** `gate1_auth_compat` (owns).

### W4 — readable time

- **Must be true:** reuse the compact time formatter + shared clock (`now`, `5m`, `2h`, `3d`,
  day when old). Hover or detail shows the full date-time + timezone. Self-updates while
  viewing, without a per-row timer or waking the whole list each second.
- **Code path:** `utils/time.ts` (compact formatter), `utils/relative-time-ticker.ts`
  (shared clock), `workspace-metadata-row.tsx`.
- **Existing tests (impl §):** shared clock/formatter + full timestamp fields implemented.
- **Missing evidence (boundary):** **real rendered platform** validation.
- **Lane:** `ui_route_evidence` (owns).

### W5 — User filter

- **Must be true:** filter workspaces the selected person created (workspace/session),
  chatted in, or gave an applied response to — **not just the last person**, so A is still
  findable after B takes over. Both unlinked account and channel filter by the identity
  rules; do not merge people just for a shared name/ID at a different source.
- **Code path:** `sidebar-view-store.ts` (strict pending-metadata handling, OR-within /
  AND-across), `session-summary.ts` (participant set), `clisbot/session-storage/directory.ts`.
- **Existing tests (impl §):** verified Member grouping + historical raw sender/member
  snapshots tested; strict filters + monotonic status.
- **Missing evidence (boundary):** full lifecycle recomputation; **actual multi-actor
  browser/native rendering**.
- **Lane:** `gate1_auth_compat` (owns filter semantics/identity). `ui_route_evidence`
  (rendered). `storage_plan_rebuild` (lifecycle recomputation).

### W6 — Channel filter

- **Must be true:** filter by the recorded channel link of a workspace. Multiple values in
  one filter = OR; User/Channel/Host/Project/existing filters combine = AND. Show/Hide does
  not affect filtering. Keep the selection across reload/host-change, with an active-filter
  indicator and a clear-filter button even with zero results; do not auto-clear just because
  a host is offline.
- **Code path:** `sidebar-view-store.ts` (metadata-only OR-within/AND-across + persistence +
  clear-filter), `directory.ts`.
- **Existing tests (impl §):** metadata-only OR-within/AND-across, persistence, strict
  pending-metadata, clear-filter logic tested.
- **Missing evidence (boundary):** **rendered offline / mixed-host / zero-result** controls.
- **Lane:** `ui_route_evidence` (owns the rendered control). `gate1_auth_compat` (filter
  semantics).

### W7 — no history reads to build the list

- **Must be true:** the daemon stores/returns aggregate metadata for the directory — creator,
  last-interaction user/time, the set of participating user keys, and a channel reference;
  the app does not open each history or call a profile per row to display/filter. New data
  updates through the existing directory-sync flow; restart still restores it; a later
  record write must not lose it.
- **Code path:** `session-summary.ts` (bounded startup inspection of private checkpoints,
  missing/damaged indexes mark summaries **pending** without rebuilding all histories during
  readiness), `directory-sync` (`runtime/directory-sync`), `workspace-directory.ts`,
  `agent-projections.ts` (directory demand feeds a bounded recovery worker; viewing a
  session promotes recovery).
- **Existing tests (impl §):** optional snapshot/cache fields, bounded startup inspection,
  and demand recovery tested; summary recovery 11 tests (empty startup, missing-index
  deferral, 64-entry queue, 130-session refill, viewed promotion + settlement demand).
- **Missing evidence (boundary):** **frozen 10,000-session directory performance**; complete
  authorized restart/move/delete; **production recovery surfaces**.
- **Lane:** `storage_plan_rebuild` (owns directory performance + recovery).

---

## C. Evidence to deliver (design.md §"Evidence required after implementation")

| Artifact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Boundary                                               | Lane                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| **Performance** — rerunnable before/after benchmark on the same machine/build; record machine/disk/client/network/cache. Datasets: 1,000/10,000 sessions, 1,000/100,000-line conversations (with tool/chunk/attachment), 10 concurrent writers. Initial targets (web/desktop production, ready daemon, SSD, local net): p95 click→last-page ≤1s (empty timeline cache / valid index); cached ≤200ms; next scroll page ≤300ms. These are **unmeasured targets**, not current numbers. Record frame time on scroll and real rendered row count. Measure mobile, relay, old-data migration, index rebuild **separately**; do not use local results for all. | Frozen source/build fingerprint; no interference.      | `storage_plan_rebuild`                                                |
| **RAM/I/O + durability** — publish cache/queue limits, batch size, flush time, records/s + bytes/s under load; record peak/steady heap, RSS, event-loop lag, durable-ack p95 latency, bytes read/written. At a fixed budget, repeated open/close/scroll of many sessions reaches a **steady RAM state** and the queue does not grow unboundedly under the published load. A process-kill and a disk-error test; clearly separate crash evidence from the OS/filesystem power-loss guarantee. Speed targets must not be met by early-ack or dropping data.                                                                                                | Whole-daemon + app + provider; real disk errors.       | `storage_plan_rebuild`                                                |
| **Upstream + not-met** — record the compared/ran version/SHA, per-AC result, the files/owners that must change and why, the isolated-checkout merge result + conflicts + remaining behavior risk, the rollback path. Change shared code when needed; do not promise "no conflict". State plainly every untested case, unmet threshold, or unsupported app/daemon combination before concluding done.                                                                                                                                                                                                                                                     | Isolated merge; official artifacts; real rendered app. | `gate1_auth_compat` (merge/official) + `ui_route_evidence` (rendered) |

---

## D. Cross-lane invariants (no lane may violate)

1. **No new format / new store.** Only the approved layout (design.md §"Settled storage layout"): one canonical `session.json`, chunked JSONL `events-NNNNNN.jsonl` + rebuildable
   `.index.json`, `uploads/`, `subagents/`. Do **not** introduce a new persistent
   tree/node-file outside the derived-document scope, and do not create a second
   simultaneously-updated record.
2. **Reconcile before claiming.** A lane may mark an AC/W "met" only with evidence at the
   exact boundary in §A/§B, and only after checking the full matrix (this file). Partial
   ≠ met.
3. **Out-of-layer changes are reported, not absorbed.** Any change that touches code
   outside the storage / session / timeline layers is written to
   [out-of-layer-changes.md](../out-of-layer-changes.md) with: reason, consequence-if-not-done,
   blast radius, and a skip-vs-do recommendation. Low-consequence items may be skipped
   rather than grown into a large blast radius.
4. **Real over fake.** If an environment is missing (no adb/emulator/Xvfb, no real
   provider, no relay), record the blocker explicitly — never claim the criterion is met.
5. **Backward-compatible wire.** New fields optional; no narrow/remove/require. Tag every
   back-compat branch `COMPAT(name)`.

---

## E. Open questions for the user (review before lanes expand scope)

- **Q1 (W3 fork/channel):** W3 says `/fork` keeps the workspace's channel info and does not
  create a new binding. Is the fork's _new_ session expected to inherit the source channel
  link, or is "keep the workspace's channel" only about the _workspace_ aggregate (W2/W3)
  while the forked session itself is channel-less? This changes how much of W3's
  "fork placement" proof `gate1_auth_compat` must produce.
- **Q2 (AC9 official rendered app):** the official 0.8.0 artifacts are staged with shared
  third-party deps. Is a **packaged** official app launch required for AC9, or is the
  four-combination wire/CLI matrix + a Fusion-rendered official-mode app sufficient?
- **Q3 (benchmark gate):** the initial p95 targets are "unmeasured". Should lanes treat
  "frozen benchmark runs and the numbers are _reported_" as the gate, or "the numbers must
  _meet_ the targets"? (README wording reads the former for AC4/AC5 and the latter for the
  §"Bằng chứng" delivery bar.)
- **Q4 (relay/native proof):** AC5/AC9/§"Bằng chứng" want native + relay. With no
  adb/emulator/Xvfb available, is a documented blocker acceptable, or must a relay/native
  environment be stood up first?
