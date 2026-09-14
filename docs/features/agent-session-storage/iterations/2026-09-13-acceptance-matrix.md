# Iteration acceptance matrix — durable timeline, fast jump, restart-safe tool approval (2026-09-13)

The iteration has two halves. A–H below cover the durable timeline and fast jump; the approval
half is covered by §F (submissions and permissions share `events.jsonl`) plus the
restart/dedupe behaviour proven in `submissions`, `summary` and `review`.

Every acceptance point stated in the iteration section of [2026-09-13-durable-timeline-and-approval.md](2026-09-13-durable-timeline-and-approval.md),
joined to the code that satisfies it and the test that proves it. That iteration doc is the contract;
this table is the audit. [implementation.md](../implementation.md) is the running evidence log.

Test shorthand:

| Key           | File                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| `acceptance`  | `packages/server/src/server/agent/session-storage/iteration-acceptance.test.ts`                              |
| `projection`  | `packages/server/src/server/agent/session-storage/projected-timeline.test.ts`                                |
| `storage`     | `packages/server/src/server/agent/session-storage/storage.test.ts`                                           |
| `summary`     | `packages/server/src/server/agent/session-storage/session-summary.test.ts`                                   |
| `review`      | `packages/server/src/server/agent/session-storage/storage-review.test.ts`                                    |
| `submissions` | `packages/server/src/server/agent/session-storage/message-submissions.test.ts`                               |
| `coalescer`   | `packages/server/src/server/agent/agent-stream-coalescer.test.ts`, `agent-manager-stream-coalescing.test.ts` |
| `client`      | `packages/client/src/daemon-client.test.ts`                                                                  |
| `capability`  | `packages/app/src/clisbot/session-storage/capability.test.ts`                                                |

## A. Target layout

| #   | Acceptance                                                                                  | Where it lives                                              | Proof                                                  |
| --- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| 1   | `session.json` holds metadata                                                               | `agent-storage.ts` (unchanged)                              | `storage` — session layout                             |
| 2   | `events.jsonl` is the only canonical source for timeline, submission and permission records | `session-event-log.ts`                                      | `acceptance` — layout: the log carries all three kinds |
| 3   | `events.index.json` is optional: offsets, anchors, id lookups                               | `session-event-log.ts` (`pointers`/`anchors`/`ids`/`tools`) | `acceptance` — rebuilds a missing or corrupt index     |
| 4   | Projection is logic, not a persisted folder                                                 | `projected-timeline.ts`                                     | `acceptance` — layout lists exactly three files        |
| 5   | Assistant chunks are coalesced in RAM or written compact                                    | `agent-stream-coalescer.ts`                                 | `coalescer`; `acceptance` — journal size               |

## B. No raw delta stream

| #   | Acceptance                                       | Where it lives                                         | Proof                                             |
| --- | ------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------- |
| 6   | No per-token line, no raw provider envelope      | `agent-manager.ts` writes coalesced items only         | `coalescer`                                       |
| 7   | Deltas merge in RAM, one record per message/tool | `agent-stream-coalescer.ts`                            | `coalescer`                                       |
| 8   | No accumulated snapshot chain                    | Coalescer emits the window delta, not the running text | `acceptance` — journal size vs the quadratic form |
| 9   | Resume checkpoints only, throttled and bounded   | No mid-stream checkpoint is written at all             | `acceptance` — layout                             |
| 10  | **Journal size measured on the same content**    | —                                                      | `acceptance` — 400 chunks vs one record           |

## C. RAM flow

| #   | Acceptance                                                    | Where it lives                                          | Proof                                     |
| --- | ------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| 11  | Small sessions may load whole                                 | `ProjectedTimeline.pageRows` widens to the full history | `projection` — golden                     |
| 12  | Large sessions load the last page; scrolling prepends/appends | `ProjectedTimeline.windowRows`                          | `projection` — bounded cold page 1k/10k   |
| 13  | Jump reads the page containing `epoch + seq`                  | `FileAgentTimelineStore.fetchCommitted` + anchors       | `acceptance` — jump outside the last page |
| 14  | Frontend reads only `TimelineState.rows`                      | App timeline reducers (unchanged)                       | `packages/app/src/timeline/*.test.ts`     |

## D. User-message list and fast jump

| #   | Acceptance                                                            | Where it lives                                       | Proof                                               |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------- |
| 15  | Each `user_message` writes `{messageId, preview, epoch, seq}`         | `derivedAnchor` in `session-event-log.ts`            | `storage` — lightweight anchors                     |
| 16  | Opening a large session reads all anchors, only the last page of rows | `listPromptIndex`                                    | `acceptance` — prompts from anchors, zero log bytes |
| 17  | Anchor → `epoch + seq` → offset → page → merge                        | `pointers` + `fetchCommitted`                        | `acceptance` — jump outside the last page           |
| 18  | Frontend never scans the whole `events.jsonl` for the list            | `agent.timeline.list_prompts` answers from the index | `acceptance` — zero log bytes read                  |
| 19  | Jump to a message outside the last page                               | —                                                    | `acceptance`                                        |
| 20  | Restart with empty memory                                             | —                                                    | `acceptance`                                        |
| 21  | Missing or corrupt anchors rebuild                                    | `SessionEventLog.rebuild`                            | `acceptance`; `projection` — deleted/corrupt index  |
| 22  | Preview/seq stay put while the turn keeps streaming                   | Anchors key on `messageId`                           | `acceptance`                                        |

## E. Compatibility gate and protocol limits

| #   | Acceptance                                                                                           | Where it lives                                                     | Proof                                              |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| 23  | Capability read from the connected daemon's `server_info.features`                                   | `capability.ts`, `daemon-client.ts`                                | `capability`; `client` — gates timeline extensions |
| 24  | No new request or field without the capability                                                       | `daemon-client.ts`                                                 | `client` — gates timeline extensions               |
| 25  | `pagingMode` only when advertised                                                                    | `daemon-client.ts:2924`                                            | `client`                                           |
| 26  | `allowDeferredPayloads` only when advertised                                                         | `daemon-client.ts:2924`                                            | `client`                                           |
| 27  | Anchor index is derived metadata an old daemon need not understand                                   | It never crosses the wire                                          | `acceptance` — layout                              |
| 28  | Coalescing does not change the legacy wire                                                           | Coalescer output is an ordinary timeline item                      | `coalescer`                                        |
| 29  | Durable submission state is optional                                                                 | `writeMessageSubmission` is an optional store method               | `submissions`                                      |
| 30  | A new request needs its own capability bit, a legacy fallback and a test against a daemon without it | `assertSessionStorageRead`                                         | `client` — refuses timeline document requests      |
| 31  | `unknown request` / `unsupported` / `access_denied` / timeout must not leave the session loading     | `deferred-timeline-item.tsx` catch/finally; client request timeout | `client` — refuses…; app deferred item error state |
| 32  | Upstream daemon without `agentSessionStorageRead`: legacy render, no new requests                    | `capability.ts` + `daemon-client.ts`                               | `client`; `capability`                             |

## F. No extra structures

| #   | Acceptance                                                                     | Where it lives                    | Proof                       |
| --- | ------------------------------------------------------------------------------ | --------------------------------- | --------------------------- |
| 33  | No `permissions/`, `submissions/`, `projection/` folders, no scattered indexes | One `SessionEventLog` per session | `acceptance` — layout       |
| 34  | Submissions and permissions live in `events.jsonl` under their own `kind`      | `SessionEventLog.stream(kind)`    | `acceptance` — layout kinds |
| 35  | Permission-history _panel_ (UI) is out of scope — restart-safe approval is not | Not touched                       | —                           |

## G. Mandatory checks

| #   | Acceptance                                                | Where it lives                                  | Proof                                                |
| --- | --------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| 36  | Live stream no slower than baseline                       | Index is checkpointed, not rewritten per append | `acceptance` — journal size timing; benchmark report |
| 37  | Assistant chunks cause no exponential growth              | —                                               | `acceptance` — journal size                          |
| 38  | A damaged index or projection rebuilds instead of hanging | `SessionEventLog.load` → `rebuild`              | `acceptance`; `projection`; `submissions`; `summary` |
| 39  | Jump works for a user message not in RAM                  | —                                               | `acceptance`                                         |

## H. Benchmark contract

| #   | Acceptance                                                                                       | Proof                                                           |
| --- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ---------------- |
| 40  | 1,000 rows is a required clean gate                                                              | `projection` — bounded cold projected page over 1000 rows       |
| 41  | 10,000 rows is a required stress gate                                                            | `projection` — bounded cold projected page over 10000 rows      |
| 42  | 100,000 rows is an optional ceiling with a ~5 minute hard timeout that cannot fail the iteration | `projection` — skipped unless `PASEO_SESSION_STORAGE_CEILING=1` |
| 43  | Upstream full-load stays the parity baseline; projection stress does not replace it              | `packages/server/scripts/session-storage-benchmark/`            | benchmark report |
