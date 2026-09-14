# Iteration 2026-09-13 — durable timeline, fast jump, restart-safe tool approval

The contract for this iteration. Status and evidence: [implementation.md](../implementation.md).
Point-by-point acceptance: [2026-09-13-acceptance-matrix.md](2026-09-13-acceptance-matrix.md).

A reduced scope that makes session storage better than old Paseo without making the frontend
depend on the on-disk layout.

**The scope has two halves, not just the timeline.** The first is the durable timeline and fast
jump, described below. The second makes **tool approval survive a daemon restart mid-flight**,
so nothing is approved twice and no decision already taken is lost:

| Problem before                                                                          | Mechanism in this iteration                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Restart while an approval is pending → the decision is lost and the user is asked again | Every response is written `pending` plus a snapshot **before** it reaches the agent tool, into `events.jsonl` itself (`kind: "permission"`). The record is still there after a restart                           |
| Answering the same request twice → approved twice, the tool runs twice                  | `PermissionResponseAdmission` serializes on the live request and checks `readPermissionResponse(agentId, id)` before forwarding; an id that already has a record returns that record instead of forwarding again |
| Retrying a prompt after a restart → the agent runs the same prompt again                | Submission ledger keyed on `clientMessageId`: `created: false` when it already exists, and it refuses if the content or sender changed (`immutable content or sender`)                                           |
| No way to tell whether a decision reached the tool                                      | Three states, `pending → applied \| failed`. `applied` only on confirmation; when unsure it **stays `pending`** and is never resent automatically                                                                |
| A status change after restart loses the approver or the ordering                        | The status update keeps the original `pending` record's `operation` — approver, timestamp and order                                                                                                              |

Both halves share one substrate: the same `events.jsonl`, the same writer lock, and the same
`operationOrder` — which is why message and approval ordering is still correct after recovery.

**Goal:** a running timeline keeps its rows in RAM and streams live exactly as old Paseo did;
on restart, or when opening an old session, the daemon loads only the page it needs into RAM;
the user-message list carries a light anchor (`messageId`, preview, `epoch`, `seq`) so a jump
can reach a message that is not resident.

**Target layout:** `session.json` (metadata), `events.jsonl` (the single canonical source for
timeline, submission and permission records), and optionally `events.index.json` (offsets,
message anchors, id lookups). Projection is the logic that builds `TimelineState.rows`; it does
not have to be a persisted folder of its own. Assistant chunks must be coalesced in RAM or
written as compact deltas — never re-written as accumulated text per chunk.

**Do not store the raw delta stream:** `events.jsonl` must not record individual tokens or
chunks, nor a provider's raw SDK envelope. The coalescer holds deltas in RAM and writes one
record at message or tool level after merging. Never produce a chain of accumulated snapshots
(`"Hel"`, `"Hello"`, `"Hello world"`) — that grows the data quadratically. Only resuming
mid-stream justifies a throttled, size-bounded delta checkpoint, and a checkpoint is not one
record per chunk.

Not valid:

```json
{"delta":"Hel"}
{"delta":"lo"}
{"delta":" world"}
```

Valid canonical form:

```json
{ "kind": "assistant_message", "messageId": "msg_1", "text": "Hello world", "seq": 42 }
```

Acceptance must measure journal size on identical content: streaming many small chunks must not
produce meaningfully more data than a single message-level record, beyond the bounded checkpoint
overhead.

**RAM flow:** a small session may load entirely; a large one loads the last page, prepends or
appends pages while scrolling, and on a jump uses the anchor/index to read the page containing
`epoch + seq` and merges it into RAM. The frontend only ever reads `TimelineState.rows`.

**User-message list and fast jump:** when a `user_message` is written, create or update a light
derived anchor in `events.index.json`:

```json
{
  "messageId": "msg_123",
  "preview": "the part in red is what I said…",
  "epoch": "epoch-1",
  "seq": 42
}
```

Opening a large session, the daemon reads the whole anchor list (small metadata only) so the
frontend can show the complete user-message list, while loading only the last timeline page into
RAM. When the user picks a message, the daemon resolves the anchor → uses `epoch + seq` to find
the offset → reads the page containing that message → merges the page into `TimelineState.rows`
→ the frontend scrolls to the record. The frontend must never have to scan or load the whole
`events.jsonl` to build this list.

**Acceptance for jump:** tests must cover a message outside the last page, a restart with empty
RAM, a missing or corrupt anchor/index (rebuild/fallback), and message preview/seq staying
correct after the assistant streams more chunks.

## Compatibility gate and protocol limits

The web app must detect the capabilities of the **daemon it is connected to** via
`server_info.features`. It must never infer them from `PASEO_AGENT_SESSION_STORAGE=1` on the
machine running the app, nor from a local URL or config. When the daemon does not advertise the
matching capability, the app must use the legacy path and send no new request or field. This is
what allows an upstream session to open without timing out or behaving incorrectly.

| Changed component                                       | What it is                                                                              | What it buys                                                                | If dropped                                                                           | Compatibility                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Message-anchor index in `events.index.json`             | Maps `userMessageId → preview + epoch + seq` so every user message has a known position | Shows the full user-message list and jumps to a message not resident in RAM | Only already-loaded messages can be jumped to; anything further needs a journal scan | Derived metadata; an older daemon need not understand it |
| `pagingMode: "source_ranges"` on `fetch_agent_timeline` | An extension parameter for reading exactly the source range of a page or entry          | Distant page reads and jumps move less data                                 | Legacy paging still works, reading a wider page                                      | Sent only when the daemon advertises the capability      |
| `allowDeferredPayloads` on `fetch_agent_timeline`       | An extension parameter letting a large payload be returned as a descriptor              | Smaller frames and less RAM for large entries                               | Full payload, or the legacy limit                                                    | Enabled only when the capability is present              |
| Coalescing assistant chunks in RAM                      | Merges many deltas into one message-level record before writing                         | A readable journal that does not grow `O(N²)`                               | Writing each delta grows the data sharply                                            | No change to the legacy wire                             |
| Durable submission state                                | Persists `clientMessageId` state across restart and retry                               | Avoids forwarding the same prompt more than once                            | A retry may re-run a prompt, as in old Paseo                                         | Optional; upstream keeps the old flow                    |

**Protocol rule:** never add a request purely to serve an internal cache or index. A new request
is acceptable only when it is directly needed for page loading or fast jump, has its own
capability bit, has a legacy fallback, and has a test against a daemon that does not support it.
The web app must treat `unknown request`, `unsupported`, `access_denied` or a timeout as a
signal to fall back or clean up — never to leave a session loading forever.

**API level (correction):** `fetch_agent_timeline` with `cursor`/`limit` is the legacy Paseo
contract. `pagingMode: "source_ranges"` and `allowDeferredPayloads` are extension parameters on
that same request, not requests of their own. `signal` is a client-local option and never
crosses the wire. `agent.timeline.list_prompts.request` and
`agent.timeline.set_subscription.request` are also legacy requests; the permission-history APIs
and events are the genuinely new part of session storage.

**Upstream matrix:** against an upstream Paseo daemon without `agentSessionStorageRead`, the app
still opens and renders sessions through the legacy timeline, and sends no source-range, deferred
payload, permission-history or subscription request. Against a capable daemon it uses page
loading and anchors. Storage improvements are opt-in per daemon, never a condition of connecting.

**Do not invent extra structures for convenience:** this iteration keeps no `permissions/`,
`submissions/` or `projection/` folders and no scattered indexes. If the product genuinely needs
to persist submissions for safe retry, or permissions for recovery after restart, those records
live in `events.jsonl` under their own `kind` — no new journal or folder. The permission-history
**panel** (UI) is out of scope; **the durability of tool-approval responses across a restart** is
in scope — see the two-halves table above.

**Mandatory checks:** the live stream must be no slower than baseline; assistant chunks must not
grow the data exponentially; a damaged index or projection must rebuild or fall back rather than
leave a session loading forever; and a jump must work for a user message not resident in RAM.

**Benchmark contract for this iteration:** acceptance uses small, fixed workloads close to real
usage. The **1,000-row dataset is a required gate** and must run clean within the time limit
recorded in the report; the **10,000-row dataset is a required stress gate** covering paging,
restart and retention. **100,000 rows is an optional ceiling diagnostic** with a hard timeout of
about five minutes; a timeout there is evidence about the limit of the stress workload and does
not fail the iteration. The upstream full-load baseline stays the parity reference; projection
stress must never be substituted for it.
