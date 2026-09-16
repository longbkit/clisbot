# Agent session storage — design and acceptance criteria

The feature's long-term contract: schema, identity rules, storage layout, data lifecycle, and
all of AC1–AC9 / W1–W7. Each iteration has its own doc under [iterations/](iterations/).

Supersedes `docs/audits/2026-09-08-workspace-placement-and-session-authorship.md`, the CONSIDER
audit this feature grew out of (removed once shipped; `git log -- <path>` still has it). Its three
open questions are all answered here: the field names it left unsettled are the envelope schema
below, and the two gaps it found in code — `AgentTimelineStore` unused at daemon startup, and
timeline content not fully reloaded — are closed by `createSessionStorageWiring` in
`packages/server/src/server/bootstrap.ts` and `durableTimelineReader` in
`packages/server/src/server/agent/agent-manager.ts`.

## Intended outcome

A creates the workspace/session, B continues the chat, C answers a question or approves: the
creator, the sender and the responder each stay correct. This holds for the Paseo app, direct
channels and Automation. An Automation records whoever triggered it; with no trigger it shows
Automation. Show/Hide only changes presentation, never access.

## Proposed schema

The fields and types below are **additions** that do not exist in the code yet. Reuse the
existing `AgentTimelineItem`, `AgentPermissionRequest` and `AgentPermissionResponse`; do not
restate their schemas.

```ts
interface SessionActor {
  kind: "user" | "automation" | "system";
  id: string;
  displayName?: string;
  avatarUrl?: string;

  // Identity scope from the Hub/channel; the table below states when each is required.
  hubOrigin?: string;
  organizationId?: string;
  connectionId?: string;
  memberId?: string;
}

// Extends only the user_message branch of AgentTimelineItem.
type UserMessageTimelineItem = Extract<AgentTimelineItem, { type: "user_message" }> & {
  sender?: SessionActor;
};

// A separate response collection, keyed by agentId in the store.
interface AgentPermissionResponseRecord {
  id: string;
  timestamp: string;
  respondedBy?: SessionActor;
  request: AgentPermissionRequest;
  response: AgentPermissionResponse;
  toolCallId?: string;
  status: "pending" | "applied" | "failed";
  error?: string;
}
```

`request` holds a snapshot of the request: `id`, `kind` (`tool | plan | question | mode | other`)
and its content. `response` holds `behavior: allow | deny`, any answers under
`updatedInput.answers`, and the choice or denial text when present. These are
[existing types](../../../packages/server/src/server/agent/agent-sdk-types.ts#L476).

| Where              | Proposed field                                                   | Rule                                                                                    |
| ------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Workspace, session | `createdBy?: SessionActor`                                       | Written at creation; never changes when someone else takes over.                        |
| Session            | `lastMessageBy?: SessionActor`                                   | Whoever sent the last `user_message`; reuse the existing `lastUserMessageAt` timestamp. |
| Session            | `lastInteractionBy?: SessionActor`, `lastInteractionAt?: string` | Counts chat and `applied` responses alike; never the timestamp of a received retry.     |

The "last" fields are aggregates. Store the journal position they were aggregated from so a
crash can be followed by reading only the remainder. If the last interaction has no known actor,
leave the actor empty rather than keeping the previous one. Creator, name and configuration stay
owned by the record. The [record-rebuild path on status updates](../../../packages/server/src/server/agent/agent-storage.ts#L240)
must be updated too, so a later write cannot drop the author fields. A workspace's channel
metadata follows the [workspace list rules](#workspace-list).

A workspace takes its last-interaction actor and timestamp from its own sessions, per the
[workspace list rules](#workspace-list); never from whoever currently has the workspace open.

## Identity rules

| Source                                      | `SessionActor.id` and scope                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| App with a verified Hub account             | `id = userId`; `hubOrigin`, `organizationId` and `memberId` must all be present.                                    |
| Channel, Member not yet linked              | `id = senderIdentity`, e.g. `slack:U123`; `hubOrigin`, `organizationId` and `connectionId` required; no `memberId`. |
| Channel, Member linked                      | Keep the channel id and scope; add the verified `memberId` and the Member's Hub profile image as `avatarUrl`.       |
| Automation with no human trigger            | `kind: automation`; the Automation id scoped to the Hub/org or the daemon that owns it.                             |
| Daemon acting on its own, e.g. an auto-deny | `kind: system`; a system id scoped to that daemon.                                                                  |

`hubOrigin` is the normalized address of the trusted Hub connection — the
[name already used in the Hub relationship config](../../../packages/server/src/server/hub/relationship-controller.ts#L328) —
carried on the actor so the same id at different Hubs stays distinguishable. A channel identity
is the tuple `(hubOrigin, organizationId, connectionId, id)`, matching the
[existing link key](../../../packages/hub/src/db/schema.ts#L645). To unify one person across app
and channel, use the verified Member link — never a display-name comparison.

One person is one profile. A snapshot names the identity someone arrived through, so the same
human has several — `slack:U1` here, the Hub `users.id` there. Everything that answers "is this
the same person" therefore keys on [`sessionParticipantKey`](../../../packages/protocol/src/session-authorship.ts#L83),
never on `actor.id`: the profile tab, the monogram colour, and adjacent-message author grouping.
`actor.id` keys one identity, which is a different question and a smaller one. The key needs the
full scope (`hubOrigin`, `organizationId`, `memberId`), so every producer must set `hubOrigin` —
an app snapshot missing it silently stops grouping with that person's channel snapshots rather
than failing. All three producers normalize it through
[`normalizeHubOrigin`](../../../packages/hub/src/managed-access/hub-origin.ts).

Reading the reader is a different question again: `isOwnActor` compares a snapshot to the _live_
account, so it matches on the Member link when both sides carry one and stays lenient about a
scope the snapshot predates.

- An unlinked sender is still known through the [existing `senderIdentity`](../../../packages/hub/src/channels/supervisor/index.ts#L156).
  Guest is only a permission group; never set `id = "guest"`. Omit a missing name or avatar; the
  app shows the identity when the name is absent. The inbound path carries no avatar today, so
  avatars need a new data source.
- Presentation: name, image and monogram are resolved together, from the organization roster when
  the reader can see the person there and from the snapshot otherwise. Resolving them separately
  is a bug waiting to happen — a current name beside a monogram derived from the name the snapshot
  froze. The face is that image (falling back on image error), otherwise a monogram (1–2 leading
  letters) of that name, with a deterministic colour seeded by the participant key, never by the
  name, so the colour survives a rename and one person keeps one face across the channels they
  speak through. The roster arrives with the account state, so a current name and avatar cost no
  request; a reader who cannot see it — signed out, or another organization — uses the snapshot.
  The identity itself is never rewritten; only how the person is presented. An
  agent without an avatar uses the default agent face: a neutral Bot icon badge, no monogram, no
  impersonation of a person. The app shows this monogram for channel, automation and system
  actors too, and never fabricates an avatar.
- Message row layout: the face sits in a fixed column beside the content, one size for every
  actor; the top of the face aligns with the top of the content — the bubble for a person, the
  agent's text block — not with the name line above it. The sender name occupies its own line,
  flush with the content edge. Other people's messages and the agent's: face and name on the
  left, content below and left-aligned (the agent has no bubble; another sender's message does).
  Your own messages: right-aligned, face and name on the right, content in a bubble. The name
  sits tight against the content. The face column spans the whole response group, including the
  turn footer, so the entire answer keeps one left edge; only the group-opening row carries the
  face and name. Identity does not change how content renders, with one exception: a reply
  directly under the name line drops the top margin of its first markdown block and the frame's
  top padding, so the face meets the first line of text. That applies only to a group-opening
  reply and only when a name line is present — later replies in the same turn, and daemons
  without session storage, keep upstream's margins. The sender name appears only on the first
  message of a consecutive same-author group. While a Hub account is still resolving, a row with
  no `sender` shows a face/name skeleton instead of guessing; with no account at all, a row
  without `sender` still right-aligns but hides both name and avatar — never "You" or "Unknown
  sender".
- Actor genuinely unknown: history that never recorded an author, or an app session with no
  verified personal account. Then omit `sender` / `respondedBy` / `createdBy`; never backfill
  old history with whoever currently has the session open.
- The Hub supplies a verified sender per operation. Never treat the channel socket's principal as
  the author: one socket is shared by many people
  ([current architecture](../../audits/2026-09-10-channel-vs-app-admission.md#link-identities--link)).
- Name, avatar and Member are snapshots taken at write time. Link/unlink does not change a
  channel id and never rewrites past authorship; later interactions record the new link.

## Id rules and writing responses

**Keep `AgentTimelineRow` as it is; do not add `row.id`.** Within a daemon/agent: a row position
is `epoch + seq`; an inbound message uses `clientMessageId`; an agent-tool id is used only when
one exists. `epoch` is a UUID created when a timeline version starts; `seq` starts at 1 and
increments. The app already produces a `clientMessageId` shaped `msg_<timestamp>_<random>` via
the [existing generator](../../../packages/app/src/types/stream.ts#L29). Follow the
[timeline contract](../../timeline-sync.md#durable-item-anchors); define no further row-id rule.

- The app or Hub creates one `clientMessageId` per logical send and keeps it across retries; the
  channel path needs wiring into this. A message replayed by the agent tool only adds a matching
  id — it never re-creates the sender. The same id with different content or a different sender
  must be rejected, never overwritten.
- `AgentPermissionResponseRecord.id`: a UUID created once by the sender, carried in a new
  optional `responseId` field and kept across retries. The daemon issues one when an older client
  omits it, and in that case promises no cross-restart duplicate protection from the client side.
  The storage key is `(agentId, id)`; the originating request is already in `request.id`, so no
  `permissionId` is added.
- Write `pending` plus the snapshot before the response is handed to the agent tool. Move to
  `applied` only after the tool confirms receipt; `failed` only on a confirmed failure. When the
  outcome is unknown, keep `pending` — "unconfirmed" — and never resend automatically.
- The store/daemon serializes on the pending request: the same id returns the stored state, and a
  different response must not replace an accepted actor or content. An adapter's request id may be
  reused; never treat it as a global key or apply an old decision to a new request after a resume.
- Responses live beside the session history and add no new `AgentTimelineItem` type. The app
  attaches one to a tool through `toolCallId` when it matches; with no matching tool it shows a
  standalone activity. An approver never becomes the author of the tool call. Response history and
  updates use their own API and cursor, and never consume a timeline `seq`.

## Settled storage layout

```text
$PASEO_HOME/
├── uploads/                                  # Temporary uploads; older files not yet migrated
└── agents/{sanitized-cwd}/{agentId}/
    ├── session.json                          # The Paseo session record
    ├── events.jsonl                          # Timeline + submission + permission
    ├── events.index.json                     # Offsets, anchors, id lookup (rebuildable)
    ├── uploads/{uploadId}/{fileName}
    └── subagents/{encodedSubagentId}/
        ├── session.json                      # Provider subagent metadata
        ├── events.jsonl
        └── events.index.json
```

Sessions created before the 2026-09-13 iteration used a segmented journal
(`events-000001.jsonl`, `events-000001.index.json`, plus `permissions/`, `submissions/` and
`projection/` folders). The first durable read imports them into `events.jsonl`, keeping the
original `epoch` and `seq`; from then on only the layout above is written.

- **One session, one official record.** Move today's `agents/{sanitized-cwd}/{agentId}.json` into
  `session.json`; never keep two copies updated in parallel. Reuse the
  [cwd-to-folder-name helper](../../../packages/server/src/server/agent/agent-storage.ts#L430);
  the folder is organisation only and never replaces `agentId` or `workspaceId`.
- **Standardise on `subagents/` and `session.json`.** A provider subagent keeps its original id,
  descriptor and own timeline through `ProviderSubagentStore`; `encodedSubagentId` is only a
  filename-safe encoding of that id. Multi-level relationships live in metadata. A Paseo subagent
  already has its own `agentId` and therefore its own session folder; keep the
  [existing relationship rules](../../agent-lifecycle.md#the-subagents-track).
- **`session.json` holds metadata; events hold interactions.** The main record holds
  configuration, workspace, resume information and authorship; a subagent record holds its
  descriptor. Events hold timeline rows, updates, question/approval responses, upload links and
  sync information. Raw SDK events are not stored. The record is not a snapshot that replaces
  events.
- **JSONL is append-only.** Each UTF-8 line is one complete record carrying a `kind`
  (`timeline`, `submission`, `permission`) and an `epoch`; an update to the same `(epoch, seq)`
  appends a new line and the index points at it. When the index is rebuilt, the last line in file
  order wins.
- **The index is rebuildable data.** It holds offsets keyed `kind:seq`, user-message anchors, id
  lookups (`client`, `provider`, `submission`, `permission`, `tool`) and the authorship
  checkpoint. It is written at checkpoints (`scannedBytes`), not on every append — rewriting the
  whole index per line would cost `O(rows²)` bytes. A lost or damaged index is rebuilt from
  `events.jsonl`; events are never deleted merely because an index exists.

## Uploads before and after an agent exists

**Today:** the [upload request carries no `agentId`](../../../packages/protocol/src/messages.ts#L2725),
so both the first message and later ones use `$PASEO_HOME/uploads/`. The flow below is the new
design, and it keys on **whether an agent exists**, not on the message number.

| When the file is chosen                                             | Upload destination and when it attaches to the conversation                                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| No agent yet, typically while composing a workspace/session request | Temporary upload; once an `agentId` is issued, verify and move the file into the agent folder before the prompt reaches the agent tool. |
| An agent exists, even with no first message sent                    | Upload straight into `agents/.../{agentId}/uploads/`; attach to the conversation only when the user sends.                              |
| Older client that sends no agent destination                        | Keep accepting temporary uploads and attach on send; existing flow stays compatible.                                                    |

An **optional** `agentId` must be added to the upload request and its client, and the field is
sent only when the daemon advertises support. The daemon checks permission on the destination
agent, that the file belongs to a sender allowed to send, and that the agent is not archived; it
never trusts a client-declared path. A file still transferring is not treated as complete.

The file–agent–message link must be durably written before the prompt is sent; a retry reuses the
link and file already accepted. Store ids and relative paths in Paseo's data and resolve them to
real paths only when handing off to the agent tool. A sent file is retained with the session; a
newly chosen but unsent file stays a draft even once it sits in the agent folder. Initially each
session uses its own copy of a file; a `/fork` that carries files must copy them and re-link the
references, not just copy the text containing a path.

Older uploads that already appear as
[absolute paths inside prompts](../../../packages/server/src/server/agent/prompt-attachments.ts#L118)
need their own migration: establish ownership and keep referenced paths valid; never bulk-move,
bulk-delete, or infer ownership from chat content. Images sent through `images` are a separate
path: retaining complete attachments means storing the received image data in the agent's
storage too, not only handling `uploaded_file`.

## Data lifecycle

| State / operation                                 | Rule                                                                                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not archived, including an agent that is `closed` | Keep the record, events, provider subagents and sent files. Never clean up based on whether a process is running.                                                |
| Archive                                           | Marked on the session record; data belonging to the session follows that state. Folders and files stay. Paseo subagents keep the existing cascade/detach rules.  |
| Restore                                           | Reuse the data in place; there is no separate `active/` or `archived/` folder.                                                                                   |
| Permanent delete                                  | Block new operations, wait for in-flight writes and uploads to finish, then delete the session's data. Deleting a timeline must never delete the record as well. |
| Unsent uploads and drafts                         | Have their own retention window; never clean up a file still transferring or one already attached to a message.                                                  |

Read/download permission for files and subagents inherits from the owning session. Sharing a
folder does not create multi-file transactions or a consistent backup during writes. If changing
`cwd` changes the storage location, the writers must coordinate and paths already handed to the
agent tool must stay valid. File-rotation thresholds, cache sizes and draft retention windows are
to be measured and settled during implementation.

## Persistence and recovery after restart

**Today:** the daemon keeps rows in RAM. The connector supplies history on reopen; provider
configuration inheritance and ACP groups share a connector
([provider registry](../../../packages/server/src/server/agent/provider-registry.ts#L441),
[ACP](../../../packages/server/src/server/agent/providers/acp-agent.ts#L1544)).
`AgentTimelineStore` now has an
[interface](../../../packages/server/src/server/agent/agent-timeline-store-types.ts#L47):
[bootstrap does not yet attach a durable store](../../../packages/server/src/server/bootstrap.ts#L978),
and [restore only takes the next sequence number](../../../packages/server/src/server/agent/agent-manager.ts#L3361).
The guarantees below are not in today's restart path.

**To implement:** persist `rows` together with `epoch`, `nextSeq` and the response collection in
the layout above; one serialized writer per journal, with a bounded queue and explicit write-error
handling. Emit a canonical acknowledgement only after a durable write succeeds; the
[current seam writes in the background](../../../packages/server/src/server/agent/agent-manager.ts#L4530)
and must be fixed. The JSON write helper currently only writes a temp file and renames, with
[no fsync](../../../packages/server/src/server/atomic-file.ts#L5); that is not a power-loss guarantee.

Restart loads only management records; history pages and indexes are read on demand, with a
size-bounded cache that evicts the least-used durably-written parts. Never hold the whole history
just because an agent is running. Reading stored history is independent of provider startup; the
[subagent API that today requires an unarchived, loaded parent](../../../packages/server/src/server/session.ts#L7441)
needs fixing too. Keep paging by
[merged display items](../../timeline-sync.md#gap-recovery-is-paged-but-complete), never by JSONL
line count.

A normal restart reads back exactly what was stored and continues `nextSeq`; a process restart
alone never creates a new epoch. If a rewind or a full history replacement changes the timeline,
create a new epoch; match rows by stored `clientMessageId` or by an id that is stable within the
same agent-tool session. For example `(epoch A, seq 12)` is An's message; `(epoch B, seq 12)` may
be someone else's — never copy An's name across just because the number or the text "OK" matches.

The [forced-reload path that currently wipes the old timeline](../../../packages/server/src/server/agent/agent-manager.ts#L3669)
must be fixed: keep the stored copy for matching before replacing it. Without a confident match,
do not move authorship onto the new rows, do not report a completed sync, and do not concatenate
two histories arbitrarily. The old copy stays readable under the retention policy; rows removed by
a rewind never return to the live timeline. Missing ids in ACP history is
[already covered by a test](../../../packages/server/src/server/agent/providers/acp-agent.test.ts#L3646).

| Case, once the design is implemented                                       | What recovers, and the limits                                                                                                                                                          |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data durably written, files intact                                         | Stored conversation rows, sender, creator, responses and the aggregate fields. Readable even when the agent tool offers no history; continuing the run still depends on the connector. |
| Output only in RAM, or never reached the daemon                            | Recoverable only if the connector can reload it. No guarantee of completeness or authorship for data never written.                                                                    |
| Crash before `pending` was stored                                          | The response was not forwarded, per the rule above; the client must resend. The daemon has no record to rebuild from.                                                                  |
| `pending` stored, crash before or after forwarding but before confirmation | Who intended to answer what is known; whether the agent tool received it is not. Stays "unconfirmed" and is never auto-approved again.                                                 |
| `applied` stored                                                           | The responder and response content recover; nothing is inferred about the tool having run or succeeded.                                                                                |
| A question/tool pending while the agent runs                               | History does not recover in-flight progress or pending callbacks. Continue only when the connector confirms the request is still valid; never reuse an old request automatically.      |
| Rewind, import, or external history change                                 | Use a new epoch when the timeline is replaced; move authorship only on a confident match. No guarantee of merging new parts of a history that lacks ids.                               |
| Channel not linked; old history; feature previously disabled               | A channel that was recorded keeps its own identity. History written without identity stays empty; re-enabling never infers authorship for the gap.                                     |
| Provider subagents and uploads/images stored per this design               | Descriptors, timelines and written files recover. Never infer that a subagent is still running from old state, and never recover provider data Paseo never received.                   |
| Lost files, expired avatar URLs, or results outside the session folder     | Without a backup, lost data does not come back. This layout does not back up workspace files, the provider's own history, or running processes.                                        |

## Compatibility and rollout scope

**Layout migration:** the new daemon recognises old files under `agents/`, old files inside the
cwd folder, and the new `session.json`. When the new layout is activated, move the record's bytes
verbatim before the session accepts writes; never parse and re-serialize, which would drop unknown
fields. Handle an existing destination, two copies of the same id, and a mid-migration crash by one
deterministic rule; an error must never present itself as an empty session list. Never load
provider history while moving a record. An old daemon cannot read the new layout: going back to an
older version needs a reverse-conversion tool that preserves events and files — not two records
updated in parallel as a compatibility path.

**Keep upstream merges cheap:** keep the names and responsibilities of `AgentStorage`,
`AgentTimelineStore`, `ProviderSubagentStore` and `FileUploadStore`. Put the JSONL/index,
session-owned file management and migration in their own modules; existing code only wires reads,
writes, file attachment and lifecycle. Do not modify individual provider adapters. Record reading
looks only for the correct `session.json` at the agent level, never scanning subagent records or
indexes. Re-check metadata-copy helpers so none copies an index while dropping events. When syncing
upstream, keep the changes around upload source/cancel and multi-level subagent relationships;
never freeze an old shape by duplicating a whole store.

Review in slices: **layout/migration → main and subagent timelines → per-agent uploads → authorship
display**. The store is chosen at bootstrap; disabling the feature never reverses the layout or
deletes data. Reading a layout already created must keep working; Managed Access off is not a
migration operation.

New wire fields are optional. The feature is toggled by the daemon and defaults off during the
trial period; the client checks `server_info.features.*` once. New APIs and events are sent only
when the client advertises support; the existing 7 item types stay. The official app with Managed
Access off still creates, chats and approves normally; a Fusion app against an official daemon
shows none of the new information. Per [protocol compatibility](../../protocol-compatibility.md),
every compatibility branch must be tagged `COMPAT` when implemented.

Re-enabling the feature must reconcile the history produced while it was off, per the recovery
rules above.

## Acceptance criteria

**Existing foundations:** the app fetches
[40 items per page](../../../packages/app/src/timeline/timeline-fetch-policy.ts#L3), uses
[virtualization on web](../../../packages/app/src/agent-stream/strategy-web.tsx#L372) and a
[FlatList on native](../../../packages/app/src/agent-stream/strategy-native.tsx#L562).
[Workspace tabs](../../../packages/app/src/workspace-tabs/model.ts#L36) have no user-profile tab
type yet, and [message rendering](../../../packages/app/src/agent-stream/view.tsx#L691) does not
yet receive a sender. None of these foundations demonstrates paged disk reads or a proven RAM
bound.

Every criterion below **must hold at implementation**, together with the rules and schema above.

### Agent session

| ID                            | Met when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 — correct sender          | Every `user_message` with `sender.kind = user` shows the name/avatar when present; a missing name falls back to the id, and a missing or broken avatar still leaves the message readable. A message from the signed-in Hub account with no recorded `sender` takes its name/avatar from the account; while the account resolves it shows a skeleton rather than guessing. A and B chatting alternately keep the right person on each message across retry, reopen and restart; two people are never merged into one author group. Covers app, direct channel and Automation per the identity rules; question/approval responses keep their own responder.                                                                                                                                                                                                                                                                   |
| AC2 — profile in a tab        | Hovering the name/avatar reveals the id; clicking opens a profile tab in the current workspace using the existing tab architecture. The tab is read-only and shows three things: the person as the Hub knows them now, every Channel identity they have linked, and the snapshot this interaction recorded. One person opens one tab however many identities they arrived through; an unlinked sender, or the same id under a different Hub/org, never opens the wrong person. Hub scopes the linked-identity list to yourself unless you administer the organization, so its absence means "not visible to you", not "none linked". Uses a snapshot the viewer is allowed to see when the profile is unlinked or cannot be loaded; never demands a new account. Closing, reopening, restoring and returning to chat preserve drafts and reading position. Touch and keyboard open the profile too — never hover-dependent. |
| AC3 — older history           | A message with no `sender` from the current app session carries the reader's identity: the Hub account when signed in; with no account it still right-aligns but hides both name and avatar — never inventing a name or a different sender. An old session receiving new messages with metadata shows authorship only on the new ones. An app against an official daemon with no metadata can still chat and read history; profile/avatar never block opening a conversation.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| AC4 — fast open               | With stored history, the first open reads and returns only the most recent page plus the index it needs; it never starts a provider or scans the whole log to get that page while the index is valid. Reuses the merged 40-item page — not 40 JSONL lines. A valid cache may render immediately and reconcile afterwards. Old history not yet stored, or an index that needs rebuilding, must have a clear state and must not be reported as fully loaded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| AC5 — fast, correct scrolling | Reuses virtualization and holds the reading position when a page is added, an avatar finishes loading, or new output arrives. Prefetches at most one page in the scroll direction and stops on session change, end of history, or cache budget. Never auto-loads to the start of a conversation just because a cursor changed. Keeps the [paging/sync contract](../../timeline-sync.md#gap-recovery-is-paged-but-complete), including a short page that does not fill the viewport, tool updates and epoch changes.                                                                                                                                                                                                                                                                                                                                                                                                         |
| AC6 — bounded RAM             | Daemon and app both cap cache by size, per session and overall, counting indexes, subagents and hidden tabs. Evicts least-used stored pages while keeping the reading region and any unfinished send/write state within its own budget. Reopening reads by page; nothing pending is lost, no message is duplicated, and no cursor is certified for an evicted range. Restart does not load all history. Long runs, or opening many sessions in turn, never retain full history; measure Paseo's RAM separately from provider processes.                                                                                                                                                                                                                                                                                                                                                                                     |
| AC7 — fast, safe writes       | Batched appends, one serialized writer per journal; bounded total I/O and a byte-bounded queue with overload handling, never blocking the event loop or rewriting the whole conversation per chunk. Record writes replace safely; data is acknowledged as stored only after it is synced to disk. A full disk or write error must be reported clearly, never acknowledged as success or silently dropped. A crash during append/rename/rotation keeps acknowledged data; an incomplete tail recovers safely and mid-file corruption is not skipped. A lost or inconsistent index must be rebuildable.                                                                                                                                                                                                                                                                                                                       |
| AC8 — full lifecycle          | Verifies migration/duplicate records, restart, retry and response races, rewind and missing ids, fork with files, deletion while an upload is in flight, and archive/restore including subagents and files, per the sections above. Stored data is readable when the agent is not running or is archived; never infer a live tool or process from history.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| AC9 — compatibility           | Verifies Fusion app ↔ Fusion daemon with the feature on and off, official app ↔ Fusion daemon with Managed Access off, Fusion app ↔ official daemon, and a mixed multi-host list. Creating workspaces/sessions, sending messages and files, approving, paging, reconnecting and the older CLI all keep working within the published scope. Disabling the feature still reads a layout already created; rolling a daemon back requires exercising the reverse-conversion path on its own.                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Workspace list

Extends the [existing Show/Hide menu](../../../packages/app/src/components/sidebar/display-preferences/menu.tsx#L551)
and the [existing filter store](../../../packages/app/src/stores/sidebar-view-store.ts#L48). The
user/channel information below is **new**, not an existing field.

| ID                                      | Met when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1 — Show/Hide                          | **Created user, Channels, Updated user, Created time, Updated time** each toggle independently inside the existing menu, and the choice survives an app restart. Turning one off returns its space to the rest. Missing data omits the entry rather than showing a fake person or a gap; filters and access are unchanged.                                                                                                                                                                |
| W2 — actor and time                     | Created user/time is who created the workspace and when. Updated user/time is who most recently **chatted or had a question/approval response `applied`**, aggregated across the workspace's sessions. The two values always come from the same interaction; with no interaction yet, both stay empty. Provider output, retries, renames and record writes never change them, and the record's technical `updatedAt` is never substituted.                                                |
| W3 — channel                            | Shows the channel name from the recorded creating/interacting source, usually one channel; with several, show one name plus `+N` and allow opening the full list. An app-created workspace is never assigned a channel by `cwd`. Renaming a channel does not break the link; the same name under a different connection/org/Hub stays distinguishable. `/side` and `/fork` in the same workspace keep the workspace's channel information and never create an extra send/receive binding. |
| W4 — readable time                      | Reuses the [compact time formatter](../../../packages/app/src/utils/time.ts#L71) and the [shared clock](../../../packages/app/src/utils/relative-time-ticker.ts#L1): `now`, `5m`, `2h`, `3d`, then a date once old. Hover or detail view shows the full date, time and timezone. Updates while visible without a timer per row or waking the whole list every second.                                                                                                                     |
| W5 — User filter                        | Filters workspaces where the selected person created the workspace/session, sent a chat, or had a response `applied` — **not merely the last actor** — so A is still findable after B takes over. Both accounts and unlinked channel senders filter per the [identity rules](#identity-rules); people are never merged just because a name or id matches across sources.                                                                                                                  |
| W6 — Channel filter                     | Filters by a workspace's recorded channel link. Multiple values within one filter are OR; User, Channel, Host, Project and the existing filters combine as AND. Show/Hide never affects filtering. Selections survive reload and host switching, with a visible active-filter indicator and a clear control even when there are no results; a selection is never dropped just because a host is offline.                                                                                  |
| W7 — no history reads to build the list | The daemon stores and returns aggregate directory metadata — creator, last interaction actor and time, the set of participating user keys, and channel references — so the app never opens each history or calls a profile per row to render or filter. Updates arrive through the existing directory sync path; a restart recovers it, and a later record write never loses it.                                                                                                          |

The aggregate covers sessions still belonging to the workspace, including archived ones; deleting
or moving a session must update it. The channel key is
`(hubOrigin, organizationId, connectionId, channelId)`; the name is display only. Return only the
people and channels the viewer is allowed to know about; a restricted session must not leak
through filter results. Older workspaces and official daemons without metadata still appear when
no User/Channel filter is applied; when one is applied, missing data never counts as a match. With
multiple hosts, show the new filters only when a supporting host exists or a selection still needs
clearing.

None of this requires additional YAML configuration.

### Evidence required after implementation

- **Performance:** a repeatable benchmark comparing before and after on the same machine and
  build, recording machine, disk, client, network and cache state. Datasets of 1,000 and 10,000
  sessions, conversations of 1,000 and 100,000 rows containing tools, chunks and attachments, and
  10 sessions writing concurrently. Initial target thresholds on production web/desktop, with the
  daemon ready, on SSD and a local network: p95 from click to a readable last page ≤ 1 s with an
  empty timeline cache and a valid index; ≤ 200 ms with a warm cache; ≤ 300 ms for the next
  scrolled page. These are **unmeasured targets**, not current figures. Record scroll frame time
  and how many rows actually render. Measure mobile, relay, legacy-data conversion and index
  rebuild separately; never let a local result stand in for all of them.
- **RAM/I/O and durability:** publish the cache/queue limits, batch size, flush interval, and the
  records/second and bytes/second of the load; record peak and steady heap, RSS, event-loop lag,
  p95 durable-acknowledgement latency, and bytes read/written. Under fixed limits, repeatedly
  opening, closing and scrolling many sessions must reach a stable RAM plateau, with the queue not
  growing without bound under the published load. Include process-kill and disk-error trials, and
  distinguish crash evidence from the OS/filesystem power-loss guarantee. Speed targets must never
  be met by acknowledging early or dropping data.
- **Upstream and what is not met:** record the versions/SHAs compared and run, the result per AC,
  which files and owners had to change and why, the result of a trial merge in a separate
  checkout, remaining conflicts and behavioural risks, and the rollback path. Change shared code
  when necessary; never promise "no conflicts". State plainly every untested case, unmet threshold
  or unsupported app/daemon combination before declaring completion.
