# Agent session storage and user/channel metadata

Durable storage for agent sessions: the timeline, tool-approval responses, prompt submissions,
authorship, uploads and subagents. This file is the index for the feature area — layout, schema
and status first, then where to read more.

## Storage layout

One folder per agent. Three files carry everything.

```text
$CLISBOT_HOME/
├── uploads/                                  # Temporary uploads, before an agent exists
└── agents/{sanitized-cwd}/{agentId}/
    ├── session.json                          # Session record: config, workspace, resume, authorship
    ├── events.jsonl                          # Append-only log: timeline + submission + permission
    ├── events.index.json                     # Derived, rebuildable: offsets, anchors, id lookups
    ├── uploads/{uploadId}/{fileName}
    └── subagents/{encodedSubagentId}/         # Same three files per provider subagent
        ├── session.json
        ├── events.jsonl
        └── events.index.json
```

Sessions written before 2026-09-13 used a segmented layout (`events-000001.jsonl`, plus
`permissions/`, `submissions/`, `projection/` folders). The first durable read imports them into
`events.jsonl`, keeping `epoch` and `seq`.

Legacy sessions that only have provider history import their replay through atomic timeline
replacement. This keeps the session writable, retains its submission and permission ledgers,
and commits the complete replay before marking history ready. Permanent session deletion is
reserved for removing the agent; it must never be used to clear history for a replay.

Whole-history replacements use a separate admission budget (32 MiB per agent, 64 MiB total,
at most two per agent and four process-wide). Live writes keep their 8 MiB per-agent budget.
If an import fails, loading closes its runtime before returning the error; the next load
resumes the provider again so a one-shot replay is not mistaken for an empty conversation.
An empty in-memory timeline left by registration does not count as imported history and
cannot suppress a retry or a read of an existing committed timeline.

A persisted draft with no provider handle and no committed timeline starts its first provider
session under the same Clisbot ID. Creation clears only retained memory for that draft; it must
not permanently delete its canonical store before the first prompt writes to it.

## File schema

**`events.jsonl`** — one JSON object per line, appended, never rewritten in place. An update to an
existing `(kind, seq)` appends a new line; the index points at the newest, and on rebuild the last
line in file order wins.

```jsonc
// envelope: { kind, epoch, seq, value, operation? }
{"kind":"submission","epoch":"217f5d67-…","seq":1,"value":{"id":"c1","digest":"sha256:…","identity":{…},"status":"pending"},"operation":{"actor":{…},"timestamp":"…","order":1}}
{"kind":"timeline",  "epoch":"217f5d67-…","seq":1,"value":{"seq":1,"timestamp":"…","item":{"type":"user_message","messageId":"m1","text":"hello","clientMessageId":"c1"}},"operation":{…}}
{"kind":"permission","epoch":"217f5d67-…","seq":1,"value":{"id":"p1","status":"pending","request":{"id":"r1","kind":"tool"},"response":{"behavior":"allow"}},"operation":{…}}
```

| Field       | Meaning                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`      | `timeline` \| `submission` \| `permission` — all three share the file, one writer lock, one `operationOrder`                                 |
| `epoch`     | UUID of the timeline version; a rewind or full replacement starts a new one                                                                  |
| `seq`       | Position within its `kind`, starting at 1                                                                                                    |
| `value`     | The record itself: an `AgentTimelineRow`, a `MessageSubmission`, or an `AgentPermissionResponseRecord`                                       |
| `operation` | Who caused it and when — `{ actor, channel?, timestamp, order }`. `order` interleaves messages and approvals so authorship survives recovery |

**`events.index.json`** — derived entirely from the log; deleting it is safe.

```jsonc
{
  "version": 3,
  "epoch": "217f5d67-…",
  "scannedBytes": 1015, // log bytes already folded in; the tail past this is rescanned on load
  "operationOrder": 2, // shared counter across submissions and permissions
  "revision": 0, // bumped when a row is rewritten in place
  "pointers": { "timeline:1": { "offset": 424, "length": 313 } },
  "anchors": [{ "messageId": "m1", "preview": "hello", "epoch": "…", "seq": 1, "timestamp": "…" }],
  "ids": { "client:c1": 1, "submission:c1": 1, "permission:p1": 1 },
  "tools": { "callId": [12, 40] },
  "summary": {}, // authorship checkpoint
}
```

It is written at checkpoints, not on every append — rewriting it per line would cost `O(rows²)`
bytes. `anchors` is what makes the user-message list and fast jump possible without reading the
log.

## What works today

| Capability                                                                      | State                                                      |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Durable timeline in `events.jsonl`, survives restart                            | Done                                                       |
| Fast jump to a message not resident in RAM, via anchors                         | Done                                                       |
| Index rebuild after loss or corruption                                          | Done                                                       |
| Tool approval survives a mid-flight restart, no duplicate approval              | Done                                                       |
| Prompt submissions deduped by `clientMessageId` across retry                    | Done                                                       |
| Capability-gated reads (`agentSessionStorageRead`); upstream daemons unaffected | Done                                                       |
| Benchmark gates at 1,000 and 10,000 rows                                        | Green — [report](benchmarks/2026-09-14-iteration-gates.md) |

Details and evidence: [implementation.md](implementation.md) ·
[iteration acceptance](iterations/2026-09-13-acceptance-matrix.md).

## History paging limits

The 32 MiB projection budget is shared by concurrent daemon reads. It applies before a
response is sent, over both direct and relay connections; the relay's frame-size ceiling is
separate. Raising the projection budget does not repair an unbounded history read.

Paging checks must measure source bytes for both legacy and `source_ranges` requests, not
only the number of returned entries. Keep a history larger than the projection budget in
regression coverage, including text continuations without message IDs, forward/backward
cursors, and a tool updated long after it started. A page must not claim an unread gap as
loaded. The source-range path reads a cursor window and its merge dependencies; plugin
identities without an occurrence index still require the full-projection fallback and remain
subject to the read budget. Tool indexes retain every occurrence: a long-running subagent
can emit hundreds of updates, and truncating those pointers makes small pages fall back to
reading the entire session. Version 3 upgrades a valid v2 checkpoint in place: preserve pointers, anchors, IDs,
summary, epoch and revision; scan only when an old tool list reached the 256-entry cap,
and replace only those lists. The canonical log and document descriptors do not change. Regression coverage includes the
255/256/257 boundary and 509 updates, deferred payloads/ranges, and restart after upgrade.
Source-range reads fold tool snapshots incrementally and retain their source ranges; the
32 MiB budget limits retained data, not cumulative bytes read across successive pages.
A tail containing only repeated subagent updates must still reach earlier main-session
messages. Child journals remain scoped to their own directories, even when call IDs match
ones in the parent. Legacy contiguous-envelope reads retain their existing behavior and may still fall back
on a full read. Source-range paging seeks the next unread interval rather than widening a
window past 8192 rows. Completed tool entries are reused within a request; dense updates
across selected tools are read together, without reading unrelated gaps.

Index upgrades, missing-index rebuilds and uncheckpointed-tail recovery stream JSONL in
64 KiB chunks. Scans are serialized process-wide and retain at most one line, capped at
16 MiB (the page reader still rejects a single row over 8 MiB). Larger lines fail explicitly with their path and offset; that failure is cached until the
journal changes. No row is silently discarded to satisfy a memory limit. Index pointers still scale with
record count. Concurrent cold callers share one load. A checkpoint write failure keeps
the completed index usable in memory and dirty for retry. Checkpoint retries follow the
normal checkpoint interval; a derived-file error does not reject an already durable append.
Explicit flush reports persistent write failures. Replacing a journal invalidates old on-disk pointers before its rewrite.
Tests cover a journal over 100 MiB, 8300 trailing updates, 9000 interleaved tool updates,
sparse pages, torn tails, checkpoint failures and restart.

### Deferred document lookup

`payload()` and `sourceRanges()` resolve the complete entry from its canonical anchor
and merge dependencies, rather than projecting the entire session. New opaque descriptors
retain the existing 64-lowercase-hex wire shape: `01` (version), 14 hex digits for the
starting seq, and 48 hex digits from SHA-256 of `epoch:start:end`. The anchor is only a
seek hint; the daemon re-derives the entry and checks the entire descriptor before returning
its payload or ranges. Epoch changes and changed merge endpoints invalidate descriptors.
No descriptor cache is needed, including across daemon restarts.

Legacy SHA-256 descriptors remain readable by scanning projected pages and releasing each
page's read budget before advancing. This can scan the session but does not retain all its
rows at once. The plugin fallback limits above still apply. Regression coverage
must fetch a deferred entry and then read every payload/range page on a session larger
than 32 MiB, including after restart, stale/invalid descriptors, and legacy IDs.

## What is not done yet

Per the 2026-09-12 campaign verdicts — **Met**: AC2, AC4, AC5, AC8, W1, W4, W5, W6.
**Partial** (implemented, evidence incomplete at the stated boundary):

| Criterion               | What is still missing                                                   |
| ----------------------- | ----------------------------------------------------------------------- |
| AC1 — correct sender    | Rendered proof across app, channel and Automation                       |
| AC3 — older history     | Chat against a no-metadata host; true mixed-host list                   |
| AC6 — bounded RAM       | App-side steady-state RSS, measured separately from the daemon          |
| AC7 — fast, safe writes | Power-loss class evidence, distinct from process-kill                   |
| AC9 — compatibility     | Fusion app ↔ official daemon, and a mixed multi-host list               |
| W2, W3, W7              | Workspace aggregate metadata proven end to end on a real directory sync |

Known cleanups, not blocking:

- `paged-journal.ts` now only imports pre-canonical sessions; its write path and crash tests no
  longer cover production and should be reduced to a reader.
- The 100,000-row ceiling is an opt-in diagnostic (`CLISBOT_SESSION_STORAGE_CEILING`), passing at
  291 s. It stays optional.
- Native, relay and real-provider behaviour are unchanged by the last iteration and unproven here.

## Where to read more

| You need                                                                                     | Read                                                          |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| The long-term contract: schema rationale, identity rules, lifecycle, AC1–AC9 / W1–W7 in full | [design.md](design.md)                                        |
| Progress and test/benchmark evidence                                                         | [implementation.md](implementation.md)                        |
| What one iteration committed to                                                              | [iterations/](iterations/)                                    |
| Why one person is one profile across their channels, and what it cost                        | [2026-09-16](iterations/2026-09-16-one-person-one-profile.md) |
| Which upstream files were touched and what was decided                                       | [upstream-blast-radius.md](upstream-blast-radius.md)          |
| Changes outside the storage / session / timeline layers                                      | [out-of-layer-changes.md](out-of-layer-changes.md)            |
| Benchmark measurements                                                                       | [benchmarks/](benchmarks/)                                    |
| The closed 2026-09-12 three-lane campaign (history, not backlog)                             | [campaign-2026-09-12/](campaign-2026-09-12/)                  |

Workspace naming, selection and reuse live in
[Workspace organization](../workspace-organization/README.md). The sidebar's per-session
lines, which show this authorship for each session, live in
[Agent sessions](../sidebar-agent-sessions/README.md).

### Image send preparation

The shared app attachment service prepares image send copies before Session,
Chat, Queue and Steer submission. It reads and prepares one original at a time,
with at most 32 images and a 32 MiB per-original bound (trusted store metadata
precheck plus an actual base64-length check). Original aggregate size alone is
not a refusal: three large phone photos can be prepared sequentially. The send
copies together contain at most 2 MiB of base64 characters. Small images fitting
their remaining share stay byte-identical; larger images first try lossless PNG
at up to 2560 pixels, then progressively smaller JPEG/WebP copies. Non-JPEG
sources use WebP for lossy steps to retain transparency. Persisted originals,
draft identities and non-image file uploads are unchanged.

This output fits the existing Host 16 MiB operation reservation, one Chat log
row and relay frame. It benefits a new app talking to an old Host without a wire
change; an old app still needs updating for oversized raw image sends. Native
encoding uses the existing Expo image manipulator and releases decoder/cache
resources. A preparation failure leaves the draft and its originals available.

Session attachment admission may retry only typed capacity refusals before any
capture or write, with the same input/message ID, after 50/150/350 ms. Intrinsic
oversize, nested source-lease failures after admission, writes, provider calls
and uncertain acknowledgements are never replayed. At most one process-wide
retry waiter retains an already bounded input (an additional conservative
16 MiB reservation, reported separately from the unchanged 64 MiB active
storage-operation budget); further contenders fail promptly. These bounds are
storage admission accounting, not a process-wide RSS guarantee.
