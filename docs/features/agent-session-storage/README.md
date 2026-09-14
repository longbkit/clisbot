# Agent session storage and user/channel metadata

Durable storage for agent sessions: the timeline, tool-approval responses, prompt submissions,
authorship, uploads and subagents. This file is the index for the feature area — layout, schema
and status first, then where to read more.

## Storage layout

One folder per agent. Three files carry everything.

```text
$PASEO_HOME/
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
  "version": 2,
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
- The 100,000-row ceiling is an opt-in diagnostic (`PASEO_SESSION_STORAGE_CEILING`), passing at
  291 s. It stays optional.
- Native, relay and real-provider behaviour are unchanged by the last iteration and unproven here.

## Where to read more

| You need                                                                                     | Read                                                 |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| The long-term contract: schema rationale, identity rules, lifecycle, AC1–AC9 / W1–W7 in full | [design.md](design.md)                               |
| Progress and test/benchmark evidence                                                         | [implementation.md](implementation.md)               |
| What one iteration committed to                                                              | [iterations/](iterations/)                           |
| Which upstream files were touched and what was decided                                       | [upstream-blast-radius.md](upstream-blast-radius.md) |
| Changes outside the storage / session / timeline layers                                      | [out-of-layer-changes.md](out-of-layer-changes.md)   |
| Benchmark measurements                                                                       | [benchmarks/](benchmarks/)                           |
| The closed 2026-09-12 three-lane campaign (history, not backlog)                             | [campaign-2026-09-12/](campaign-2026-09-12/)         |

Workspace naming, selection and reuse live in
[Workspace organization](../workspace-organization/README.md).
