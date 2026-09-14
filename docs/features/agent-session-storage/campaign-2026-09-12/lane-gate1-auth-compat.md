# Lane report — gate1_auth_compat

> Historical record of the 2026-09-12 campaign. Current state: [implementation.md](../implementation.md).

**Goal:** agent-session-storage AC1–AC9 + W1–W7. **Lane scope:** identity / authorship /
authorization / provider / compatibility. **Owned:** AC1, AC8 (cross-principal retry slice),
W2, W3, W5, W6, + all of AC3/AC9 (provider part of AC1/AC8).
**Date:** 2026-09-12. **Source under test:** this working tree, HEAD
`3e4df80f43ad78218486ac1b3414f98fc71c6b17` + uncommitted tracked/untracked changes. All
`/tmp/gate1-*` logs were produced on this exact source in the 2026-09-12 03:30–03:48 UTC
window (source is dirty, so prior Sep 11/12 checkpoints are stale and were re-run).

This report records, per owned criterion: current code path, existing evidence (cited to
`implementation.md`), what this run did (exact commands + new `/tmp/gate1-*` log paths),
current status against the exact `goal-matrix.md` boundary, and the missing evidence.

Status vocabulary: **Met-at-boundary** / **Partial** / **Blocked** (with reason).
Cross-lane note: `ui_route_evidence` owns every "rendered …" boundary cited below;
`storage_plan_rebuild` owns lifecycle/rollback-recovery/perf. This lane owns the
identity/authorship/authorization/provider semantics and the compatibility matrix.

---

## This-run summary

| AC/W                | Status                          | One-line why                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1                 | Partial                         | All fixture-boundary identity gates green on current source; cross-principal retry now closed at the storage boundary; real-Hub + real-channel + real-provider alternation + rendered author grouping unmet (no live Hub/channel/provider env on this box). |
| AC8 cross-principal | Met-at-boundary (storage slice) | New two-principal test proves a second principal's retry of the same logical message conflicts (never overwrites) and a foreign upload is rejected at the connection boundary. Full AC8 lifecycle = storage lane.                                           |
| AC9                 | Partial                         | 4-combo official wire/CLI matrix + upstream merge rehearsal + real rollback CLI/old-reader all green; official rendered app, mixed multi-host, production-build combos, and a packaged old-daemon/browser launch unmet.                                     |
| AC3 (support)       | Partial                         | Legacy reconciliation + 4 official combos green on current source; rendered official app not represented by the client package.                                                                                                                             |
| W2                  | Partial                         | Aggregation/ordering/actor-time-suppression green; end-to-end across every provider/automation path + recovery/delete races remain under review.                                                                                                            |
| W3                  | Partial                         | Scoped channel snapshots + key-separation + rename-stability-of-identity green; rename/multi-channel/fork transport proof incomplete (Q1 open).                                                                                                             |
| W5                  | Partial                         | Filter semantic identity + OR-within/AND-across/persistence green; multi-actor rendered list = UI lane; lifecycle recomputation = storage lane.                                                                                                             |
| W6                  | Partial                         | Metadata-only OR-within/AND-across, persistence, strict-pending, clear-filter green; rendered offline/mixed-host/zero-result controls = UI lane.                                                                                                            |

## Run log (this run, all on current source HEAD `3e4df80f4`)

| Time (UTC)       | Command                                                                                                                                                                                                                                         | Log                                                                           | Result                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-12 03:31 | `npx vitest run src/server/agent/session-authorship.test.ts src/server/agent/session-storage/message-submissions.test.ts src/server/agent/permission-response-journal.test.ts src/server/agent/session-summary.test.ts --bail=1 --maxWorkers=1` | `/tmp/gate1-ac1-identity-core.log`                                            | 4 files / **38 passed**, 20.35 s. W2 durable summary ordering + replay + actor/time suppression; same-id/different-content + same-id/different-sender conflict; pending-before-forward/applied-after-ack; replay.                                                                                                                                                                   |
| 2026-09-12 03:32 | `npx vitest run src/server/agent/agent-manager.test.ts -t "trusted operation identity\|permission hook\|rollout-off\|rewind resolves provider identity" --bail=1 --maxWorkers=1`                                                                | `/tmp/gate1-ac1-manager-identity.log`                                         | **4 passed** \| 176 skipped, 6.08 s. Creator/sender structured-clone snapshots, retry `duplicate=true`, same-id/different-sender "immutable" reject, automatic system actor `daemon:test-daemon:provider:codex:permission-policy`, rollout-off no auto-capture.                                                                                                                     |
| 2026-09-12 03:32 | `npx vitest run src/channels/daemon/session-operation.test.ts src/managed-access/session-operation-tickets.test.ts src/managed-access/tickets.integration.test.ts --bail=1 --maxWorkers=1` (hub)                                                | `/tmp/gate1-hub-ticket-tests.log`                                             | 3 files / **11 passed**, 65.70 s. Per-operation trusted Hub identity tickets: 15-min lease + override, additive Team+Member grants, fail-closed admin delegation, unattended-Automation/auto-accept rejection, verifier-stored/consumed-once/client-bound/revocation-before-notify.                                                                                                 |
| 2026-09-12 03:39 | `npx vitest run src/server/agent/agent-manager.test.ts -t "permission tool anchors\|canonical submitted prompt" --bail=1 --maxWorkers=1`                                                                                                        | `/tmp/gate1-identity-anchor.log`                                              | **3 passed** \| 177 skipped, 11.97 s. Sender from accepted submission identity; permission tool anchors.                                                                                                                                                                                                                                                                            |
| 2026-09-12 03:39 | `npx vitest run src/server/session.test.ts -t "permission generation" --bail=1 --maxWorkers=1`                                                                                                                                                  | `/tmp/gate1-generation.log`                                                   | **1 passed** \| 151 skipped, 19.04 s. Generation scoped to capable sources only; no mutation of the live request.                                                                                                                                                                                                                                                                   |
| 2026-09-12 03:40 | `npx vitest run src/server/agent/providers/acp-agent.test.ts -t "emits the submitted user message even when\|without message ids across turns" --bail=1 --maxWorkers=1`                                                                         | `/tmp/gate1-identity-acp.log`                                                 | **2 passed** \| 97 skipped, 4.48 s. README-cited ACP missing-ID / cross-turn capture case.                                                                                                                                                                                                                                                                                          |
| 2026-09-12 03:40 | `PASEO_OFFICIAL_ARTIFACT_DIR=/tmp/session-storage-official-0.8.0 npx vitest run src/server/official-session-storage-matrix.test.ts --bail=1 --maxWorkers=1`                                                                                     | `/tmp/gate1-official-matrix.log`                                              | 1 file / **4 passed**, 88.32 s. The four published 0.8.0 combinations (see AC9).                                                                                                                                                                                                                                                                                                    |
| 2026-09-12 03:42 | `npx vitest run src/stores/sidebar-view-store.test.ts src/clisbot/session-storage/directory.test.ts src/clisbot/session-storage/capability.test.ts --bail=1 --maxWorkers=1` (app)                                                               | `/tmp/gate1-w5w6-app-filters.log`                                             | 3 files / **25 passed**, 2.97 s. W5/W6: OR-within / AND-across, User/Channel selections, persistence across offline catalog changes.                                                                                                                                                                                                                                                |
| 2026-09-12 03:43 | `node scripts/rehearse-agent-session-storage-merge.mjs --worktree /tmp/gate1-upstream-rehearsal --report /tmp/gate1-upstream-rehearsal-report.json`                                                                                             | `/tmp/gate1-merge-rehearsal.log`, `/tmp/gate1-upstream-rehearsal-report.json` | Isolated snapshot `1a6bf34da5feefee760619c76a77f18b0cac2bf9`; source HEAD `3e4df80f4`, target `fa93c4290eaa87ae58452ab6e2012f85ae6e0c6b`, common ancestor `9400a49af670fdb5db4af58e73f8df98588dbea9`; **57 conflicting paths**, merge exit 1 (expected, unmerged). `rootBranchAndStagedIndexUnchanged: true`, `sourceChangedAfterSnapshot: false`, 111 untracked files snapshotted. |
| 2026-09-12 03:44 | `node --expose-gc --import tsx packages/server/scripts/session-storage-benchmark/rollback-check.ts /tmp/session-storage-baseline-3e4df80`                                                                                                       | `/tmp/gate1-rollback-check.log`                                               | "Rolled back 1 session records; journals and uploads retained." `oldReaderCount: 1`, `exactOriginalRecordBytesRetained / uploadsRetained / currentJournalReadableAfterRollback` all `true`, epoch `5d7f644e-122f-46e9-a633-ac88bdeb0f28`.                                                                                                                                           |
| 2026-09-12 03:46 | `npx vitest run src/triggers/manual/source.test.ts src/channels/daemon/session-operation.test.ts --bail=1 --maxWorkers=1` (hub)                                                                                                                 | `/tmp/gate1-automation-hub.log`                                               | 2 files / **5 passed**, 6.05 s. Manual-trigger intake + forged vs verified identity (matches impl "Hub 5 tests").                                                                                                                                                                                                                                                                   |
| 2026-09-12 03:46 | `npx vitest run src/server/hub/execution-controller.test.ts -t "enrolled Hub execution persists creator" --bail=1 --maxWorkers=1`                                                                                                               | `/tmp/gate1-automation-daemon.log`                                            | **1 passed** \| 13 skipped, 69.33 s. Automation actor with stamped `hubOrigin: https://hub.test` vs forged `https://forged.invalid` input; persisted `createdBy` + `user_message` sender.                                                                                                                                                                                           |
| 2026-09-12 03:47 | `npx vitest run src/server/agent/permission-response.test.ts src/server/agent/providers/codex-app-server-agent.test.ts -t "respondToAgentPermission\|synthetic plan cancellation\|automatic permission" --bail=1 --maxWorkers=1`                | `/tmp/gate1-provider-permission.log`                                          | 2 files / **4 passed** \| 149 skipped, 10.57 s. Follow-up capture, pending retained on failure, plan cancellation.                                                                                                                                                                                                                                                                  |
| 2026-09-12 03:38 | `npx vitest run src/server/file-upload/session-files.test.ts --bail=1 --maxWorkers=1` (with the new test)                                                                                                                                       | `/tmp/gate1-ac8-cross-principal.log`                                          | 1 file / **7 passed** (was 6), 4.69 s. Includes the new multi-principal retry test.                                                                                                                                                                                                                                                                                                 |

Quality gates on the only file changed this run: `npm run format:files --
packages/server/src/server/file-upload/session-files.test.ts` (exit 0, `/tmp/gate1-format.log`),
`npm run lint -- packages/server/src/server/file-upload/session-files.test.ts` (0 warnings/0
errors, `/tmp/gate1-lint.log`), `npm run typecheck --workspace=@getpaseo/server` (exit 0,
`/tmp/gate1-typecheck-server.log`).

## Changes made this run

**One test added, in-layer, test-only (no production code touched).**

`packages/server/src/server/file-upload/session-files.test.ts` — new
`it("rejects an independent multi-principal upload retry instead of overwriting the accepted
owner")` (lines 188–234). It models two independent connections as two principals (each owns
its own `FileUploadStore` via `resolveAgentDirectory` → same session dir), and asserts:

1. Principal B's retry of the same logical message `m1` with a _different_ accepted file set
   throws `"conflicts"` (does not overwrite A's owner).
2. Principal B referencing A's upload it does not own (`ownsUpload` = B's
   `ownsUploadedFile`) throws `"does not belong"` at the connection boundary.
3. A's original accepted link bytes are untouched (`"hello"`).

This is the storage/session-file boundary slice of AC8 "cross-principal retry" and of AC1
"persisted client-message admission." It closes the named missing item in
`implementation.md` "Remaining work / limits" ("independent multi-principal upload retry
remains incomplete"). **Layer:** file-upload / session-files = storage+session layers, so this
is in-layer and requires no `out-of-layer-changes.md` entry (see §Out-of-layer).

No other files were created or modified by this lane.

---

## Per-criterion detail

### AC1 — Correct sender (owned)

- **Code path (current):** `session-authorship.ts` (`recordSessionInteraction` dedups by
  `sessionActorKey`+memberId, last-interaction ordering, unknown-actor clears last actor;
  `aggregateWorkspaceAuthorship` keeps workspace createdBy/createdAt, pending suppresses the
  latest actor/time pair), `message-submissions.ts` (`writeMessageSubmission`: prior +
  digest/identity mismatch → `"Logical message ID conflicts with its immutable content or
sender"`; applied blocks pending), `permission-response-journal.ts` (`respondedBy`
  snapshot, pending-before-forward/applied-after-ack), `permission-generation-projection.ts`
  (generation removed only for legacy outbound consumers), `agent-manager.ts`
  (`admitMessageSubmission` duplicate-pending→throw, `captureSessionIdentity`
  structuredClone, `recordSubmittedPrompt` sender from accepted submission, marks applied
  after persistence), hub `channels/daemon/session-operation.ts` (channel sender actor
  `id = source.senderIdentity` + `hubOrigin/organizationId/connectionId` + verified
  `memberId`; system ops `kind: system`), `managed-access/session-operation-tickets.ts`,
  `managed-access/automation-session-identity.ts` (automation initiator from Member row,
  never payload actor).
- **Existing evidence (impl §):** acceptance table AC1 row; "Focused validation" →
  `Authorship and archived permission RPC`, `Provider policy admission`, `Automation
identity` (Hub 5 / enrolled daemon 1), `Identity follow-up` (capture-off/queue/recovery/ACP/
  exact-tool-cursor).
- **This run:** the AC1 identity-core, manager-identity, hub-ticket, automation-hub,
  automation-daemon, provider-permission, identity-anchor, generation, and identity-acp logs
  above — all green on current source.
- **Status: Partial.** Met-at-boundary for the _fixture_ identity/authorship/authorization
  gates and for the cross-principal upload retry (storage slice). **Missing at the exact
  boundary:** real Hub access-store + real channel + **real provider** A/B alternation
  _rendered_ (fixture providers only; no live Hub/channel/provider auth on this box), and
  rendered author grouping (UI lane). Fixture-provider evidence is explicitly not
  real-provider.

### AC8 — Cross-principal retry slice (owned; full lifecycle = storage lane)

- **Code path (current):** `file-upload/index.ts` (`FileUploadStore` instantiated per client
  Session = per principal/connection; `ownsUpload`/`ownsUploadedFile` gate; durable uploads
  get `upload_<uuid>` ids), `file-upload/session-files.ts` (`attachSessionFiles` retry path
  compares accepted non-image/non-fork files `[id,fileName,mimeType,size]`, image digests,
  fork sources → mismatch throws `"Message attachment retry conflicts with the accepted
files"`; `addUploadedFiles` enforces `input.ownsUpload(upload)` else `"Uploaded file does
not belong to this connection"`), `session/files/workspace-files-session.ts`
  (`this.fileUploads = new FileUploadStore(...)` per client session;
  `attachMessageFiles` passes `ownsUpload`).
- **This run:** the new test above (`/tmp/gate1-ac8-cross-principal.log`, 7 passed).
- **Status: Met-at-boundary (storage/session-file slice).** The independent
  multi-principal retry no longer overwrites the accepted owner and a foreign upload is
  rejected at the connection boundary. Full AC8 lifecycle (migration/rollback, fork/delete
  leases, rendered app download, all provider paths) remains storage-lane owned and is
  **not** claimed here.

### AC9 — Compatibility (owned)

- **Code path (current):** `features.agentSessionStorage` (capture, default off) +
  `features.agentSessionStorageRead` (retained durable reads incl. rollout-off sessions);
  `CLIENT_CAPS.agentSessionStorage` gates new read shapes;
  `official-session-storage-matrix.test.ts`; `rollback-session-layout.ts`;
  `scripts/rehearse-agent-session-storage-merge.mjs`.
- **Existing evidence (impl §):** "Benchmarks and compatibility artifacts" → actual
  dirty-snapshot merge (55 conflicts, Sep 11), baseline merge-tree (45), actual rollback
  report, four published official 0.8.0 combinations (gitHead
  `b8e24677e12b226c7c38c1c3a40649daa9f1152f`).
- **This run:**
  - Official matrix: 4 passed on current source (`/tmp/gate1-official-matrix.log`) —
    official client→Fusion capture off, official client→Fusion capture on, Fusion
    client→official daemon, and official CLI (create, send image, approve, page logs,
    reconnect to Fusion off) via the published `@getpaseo/cli` bin. Re-run because source
    changed after the Sep 12 checkpoint.
  - Merge rehearsal: **57 conflicts** on current dirty source (`/tmp/gate1-merge-rehearsal.log`,
    `/tmp/gate1-upstream-rehearsal-report.json`). New surfaces vs the Sep 11 55-conflict
    snapshot and the 45-conflict baseline merge-tree at the same HEAD:
    `file-upload/index.ts(+test)`, `workspace-files-session.ts(+test)`, `agent-prompt.ts`,
    `timeline-projection.ts`, `operation-permissions.ts`, `viewed-timeline-sync.ts`,
    `directory-sync/index.ts`, `daemon-client.ts(+test)`, `client-capabilities.ts`, plus
    `agent-manager.ts`, `session.ts`, `websocket-server.ts`, `messages.ts`,
    `bootstrap.ts`, `render.ts`, package.json/public-docs. Root branch + staged index
    unchanged; 111 untracked files snapshotted; source unchanged after snapshot.
  - Rollback: real rollback CLI + baseline old-source reader (`/tmp/gate1-rollback-check.log`)
    — original record bytes (incl. a future field) retained, uploads retained, old
    `AgentStorage.list()` returns 1. **Limitation (recorded):** HEAD AgentStorage source with
    shared installed deps; not a packaged old daemon/browser launch.
- **Status: Partial.** Met-at-boundary for the four 0.8.0 wire/CLI combinations, the isolated
  merge rehearsal (conflict surface classified, root untouched), and the source-level
  rollback reverse-conversion. **Missing at the exact boundary:** official _rendered_ app,
  mixed multi-host list, production-build combinations, and a packaged old
  daemon/browser launch.

### AC3 — Old history (provider/compatibility part, owned)

- **Code path (current):** optional `sender`/`respondedBy`/`createdBy` fields; legacy
  reconciliation preserving unknown authors; default-off + old-parser paths;
  `recover-session-authorship.ts`; `official-session-storage-matrix.test.ts`.
- **This run:** the same four official combinations above (app meeting an official
  no-metadata daemon still chats/reads history; profile/avatar never blocks). Legacy
  reconciliation + default-off covered by existing tests (impl "Focused validation").
- **Status: Partial.** **Missing at the exact boundary:** a rendered official app (the client
  package does not represent the official UI).

### W2 — People + time (owned: aggregation semantics)

- **Code path (current):** `session-summary.ts` (durable summary ordering + replay +
  actor/time suppression), `agent-projections.ts`, `session-authorship.ts` (last accepted
  message / last applied permission response carry durable ordering metadata).
- **This run:** covered inside the AC1 identity-core run (38 passed, `/tmp/gate1-ac1-identity-core.log`)
  — durable summary ordering, replay, duplicate/retry, and actor/time suppression (provider
  output / retry / rename / record write do not move it; the record's technical `updatedAt`
  is never substituted).
- **Status: Partial.** **Missing at the exact boundary:** end-to-end interaction timestamps
  across _every_ provider/automation path; recovery/delete races "remain under review"
  (storage lane). Rendered = UI lane.

### W3 — channel (owned)

- **Code path (current):** scoped channel snapshots + source propagation
  (`session-authorship.ts`, `session-summary.ts`); channel key
  `(hubOrigin, organizationId, connectionId, channelId)`.
- **This run:** channel key separation (same name under a different connection/org/Hub stays
  distinct) and rename-keeps-the-link identity semantics are covered in the AC1 identity-core
  suite (38 passed). `/side`+`/fork` keep the workspace channel without a new binding is
  exercised at the file layer by the fork tests in `session-files.test.ts`
  (`/tmp/gate1-ac8-cross-principal.log`).
- **Status: Partial.** **Missing at the exact boundary:** full channel _rename /
  multiple-channel / fork placement transport_ proof. **Open question Q1:** does the fork's
  _new_ session inherit the source channel link, or does "keep the workspace's channel" only
  govern the workspace aggregate (W2/W3) while the forked session is channel-less?

### W5 — User filter (owned: filter semantics/identity)

- **Code path (current):** `sidebar-view-store.ts` (strict pending-metadata, OR-within /
  AND-across), `session-summary.ts` (participant set), `clisbot/session-storage/directory.ts`.
- **This run:** W5/W6 app filter run (25 passed, `/tmp/gate1-w5w6-app-filters.log`) — User
  selections filter by identity rules (not just the last person; A stays findable after B
  takes over), no merge on shared name/ID at a different source, OR-within/AND-across,
  persistence across offline catalog changes.
- **Status: Partial.** **Missing at the exact boundary:** full lifecycle recomputation (storage
  lane) and actual multi-actor browser/native rendering (UI lane).

### W6 — Channel filter (owned: filter semantics)

- **Code path (current):** `sidebar-view-store.ts` (metadata-only OR-within/AND-across +
  persistence + clear-filter), `directory.ts`.
- **This run:** W5/W6 app filter run (25 passed, `/tmp/gate1-w5w6-app-filters.log`) — Channel
  selections, OR-within/AND-across, persistence, strict pending-metadata, clear-filter
  logic, and that Show/Hide does not affect filtering.
- **Status: Partial.** **Missing at the exact boundary:** rendered offline / mixed-host /
  zero-result controls (UI lane).

---

## Compatibility + merge + rollback artifacts (AC9 delivery, goal-matrix §C "Upstream + not-met")

- **Compared/ran version + SHA:** source HEAD `3e4df80f43ad78218486ac1b3414f98fc71c6b17`
  (+ dirty tracked/untracked); upstream target `fa93c4290eaa87ae58452ab6e2012f85ae6e0c6b`;
  common ancestor `9400a49af670fdb5db4af58e73f8df98588dbea9`; isolated snapshot
  `1a6bf34da5feefee760619c76a77f18b0cac2bf9`; official published 0.8.0 (registry gitHead
  `b8e24677e12b226c7c38c1c3a40649daa9f1152f`), tarballs staged at
  `/tmp/session-storage-official-0.8.0` under `PASEO_OFFICIAL_ARTIFACT_DIR`.
- **Per-AC result:** four 0.8.0 combinations green (official-client→Fusion off/on,
  Fusion-client→official-daemon, official-CLI→Fusion-off); AC3 "no-metadata still reads"
  green via the same combos.
- **Files/owners that must change (why):** the 57-conflict surface spans `protocol`
  (`messages.ts`, `client-capabilities.ts`), `server` (`agent-manager.ts`, `session.ts`,
  `websocket-server.ts`, `bootstrap.ts`, `authorization/*`, `file-upload/*`,
  `session/files/workspace-files-session.ts`), `app` (`types/stream.ts`,
  `timeline/session-stream-reducers.ts`, `viewed-timeline-sync.ts`, `directory-sync`), and
  `cli` (`output/render.ts`). Owner: coordinated — this lane owns the `authorization/*` +
  identity + file-upload conflict semantics; storage lane owns the journal/layout side; UI
  lane owns the app timeline/reducer side.
- **Isolated-checkout merge result + conflicts + remaining behavior risk:** merge exit 1
  (unmerged), 57 conflicts, root branch + staged index unchanged, source unchanged after
  snapshot. Remaining behavior risk: these are _content_ conflicts in shared files that both
  sides (feature branch + upstream `fa93c4290`) have edited; a resolved merge must be
  re-validated against the four-combo matrix + rollback before it can be claimed. No
  "no conflict" promise is made.
- **Rollback path:** `rollback-session-layout.ts` (record-only, `--daemon-stopped`, pid lock,
  moves `session.json` back to `{dir}.json`, retains journals/uploads) verified by
  `session-storage-benchmark/rollback-check.ts` against a baseline old-source reader
  (`/tmp/gate1-rollback-check.log`). Not a packaged old daemon/browser launch.

## Out-of-layer changes

**None filed.** The only change this lane made is a test inside
`packages/server/src/server/file-upload/session-files.test.ts` (file-upload +
session-files = storage/session layers), so it is in-layer. `out-of-layer-changes.md`
requires no new entry. No production code, no wire schema, no `COMPAT(name)` tag, and no
architectural surface was touched by this lane.

## Open questions carried to the user (from goal-matrix §E)

- **Q1 (W3 fork/channel):** Does the fork's new session inherit the source channel link, or
  is "keep the workspace's channel" only about the workspace aggregate while the forked
  session is channel-less? Determines how much W3 "fork placement" proof this lane must
  produce.
- **Q2 (AC9 official rendered app):** Are the four-combination wire/CLI matrix + a
  Fusion-rendered official-mode app sufficient for AC9, or is a _packaged_ official app
  launch required? (Currently unmet either way — no packaged official launch exists.)
- **Q3 (benchmark gate):** For AC4/AC5 and the §"Bằng chứng" delivery bar, is
  "frozen benchmark runs + numbers _reported_" the gate, or must the numbers _meet_ the
  unmeasured p95 targets? (Touches AC9 delivery wording.)
- **Q4 (relay/native proof):** With no adb/emulator/Xvfb, is a documented blocker acceptable
  for the native + relay pieces of AC5/AC9/§"Bằng chứng", or must a relay/native environment
  be stood up first?

## Plainly unmet (not claimed)

- **Mixed multi-host** (AC9): not produced this run — no multi-host environment stood up.
- **Official rendered app** (AC9/AC3): unmet — the matrix proves wire/CLI, not the rendered
  official UI; no packaged official launch.
- **Real-Hub + real-channel + real-provider A/B alternation, rendered** (AC1): unmet on this
  box (fixture providers only; no live Hub/channel/provider auth).
- **Production-build combinations** (AC9): unmet.
- **W3 rename / multi-channel / fork placement transport proof** (W3): incomplete (Q1 open).
- **OpenCode-specific provider call-site coverage** (AC1 provider part): per
  `implementation.md` "Provider policy admission," still incomplete.
