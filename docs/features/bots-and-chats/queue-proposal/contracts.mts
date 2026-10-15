/** PROPOSED ONLY — CTO-021 owner review. No production module imports this file.
 * If approved, move these structural declarations to protocol/chats and the store
 * record to server/chats, then generate both JSON Schema and ws AOT from that source.
 */
import { z } from "zod";
import {
  AgentAttachmentSchema,
  ImageAttachmentSchema,
} from "../../../../packages/protocol/src/agent-attachments.js";
import {
  SessionActorSchema,
  SessionChannelReferenceSchema,
} from "../../../../packages/protocol/src/session-authorship.js";

// Existing message IDs are opaque: UUIDs, msg_* and caller-chosen strings all work.
// Normalization, path safety and resource limits remain Host admission invariants.
const Id = z.string().min(1);
const Counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const Sequence = Counter.min(1);
const Time = z.iso.datetime({ offset: true, precision: 3 });
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Position = z.strictObject({ epoch: Id, seq: Sequence });
const Content = z.strictObject({
  text: z.string(),
  images: z.array(ImageAttachmentSchema),
  attachments: z.array(AgentAttachmentSchema),
});
const Receipt = z.strictObject({
  messageId: Id,
  queueSeq: Sequence,
  acceptedAt: Time,
  acceptedRevision: Sequence,
});
const Lease = z.strictObject({
  claimId: Id,
  hostBootId: Id,
  expiresAt: Time,
  attempt: z.number().int().min(1).max(3),
});
const Delivery = z.strictObject({
  botId: Id,
  agentId: Id,
  clientMessageId: Id,
  disposition: z.enum(["turn_started", "steered", "out_of_band"]),
  turnId: Id.nullable(),
  submittedRow: Position,
});
const Outcome = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("queued") }),
  z.strictObject({ state: z.literal("claimed"), lease: Lease }),
  z.strictObject({
    state: z.literal("applied"),
    transcript: z.strictObject({ messageId: Id, seq: Sequence }),
    deliveries: z.array(Delivery),
    appliedAt: Time,
  }),
  z.strictObject({ state: z.literal("canceled"), canceledAt: Time }),
  z.strictObject({
    state: z.literal("failed"),
    failedAt: Time,
    code: z.enum([
      "access_revoked",
      "target_gone",
      "content_unavailable",
      "definitive_rejection",
      "retry_exhausted",
    ]),
    detail: z.string().min(1),
  }),
  z.strictObject({
    state: z.literal("unknown"),
    claimId: Id,
    observedAt: Time,
    code: z.enum(["host_restarted", "provider_outcome_unknown"]),
    detail: z.string().min(1),
  }),
]);
// Recipients are a Host-resolved snapshot of existing mention/room rules. Clients
// never send a trusted target list or actor. Editing recomputes recipients at Host.
const Audience = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("direct"), botId: Id }),
  z.strictObject({
    kind: z.literal("group"),
    mode: z.enum(["open", "addressed"]),
    botIds: z.array(Id),
  }),
]);
export const Entry = z.strictObject({
  receipt: Receipt,
  revision: Sequence,
  content: Content,
  contentDigest: Digest,
  actor: SessionActorSchema,
  audience: Audience,
  outcome: Outcome,
});
// Persist immutable payloads once with the existing durable-file/file-pinning
// boundary. Queue transactions retain references, not copies of image bytes.
const ContentReference = z.strictObject({
  relativePath: z.string().regex(/^queue-content\/[a-f0-9]{64}\.json$/),
  size: Sequence,
  sha256: Digest,
});
const StoredEntry = Entry.omit({ content: true }).extend({ contentRef: ContentReference });
const Error = z.strictObject({
  code: z.enum([
    "invalid_input",
    "access_denied",
    "conflict",
    "not_found",
    "unsupported",
    "busy",
    "limit_exceeded",
    "outcome_unknown",
  ]),
  message: z.string().min(1),
});
const CommandResult = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("accepted"),
    revision: Sequence,
    receipt: Receipt.nullable(),
    duplicate: z.boolean(),
  }),
  z.strictObject({ status: z.literal("rejected"), revision: Counter.nullable(), error: Error }),
]);
const commandBase = { requestId: Id, chatId: Id };
// mutationId dedupes a committed command, including durable rejection. A refusal
// before admission has no receipt; messageId dedupes the input.
// Full command bytes + authenticated actor identity are bound to mutationId.
const mutation = { ...commandBase, mutationId: Id };
const conditional = { ...mutation, expectedRevision: Counter };
const entryMutation = { ...conditional, messageId: Id, expectedEntryRevision: Sequence };
const Enqueue = z.strictObject({
  type: z.literal("chat.message.enqueue.request"),
  ...mutation,
  messageId: Id,
  content: Content,
});
const Edit = z.strictObject({
  type: z.literal("chat.message.edit.request"),
  ...entryMutation,
  content: Content,
});
const Cancel = z.strictObject({ type: z.literal("chat.message.cancel.request"), ...entryMutation });
const Reorder = z.strictObject({
  type: z.literal("chat.queue.reorder.request"),
  ...conditional,
  messageIds: z.array(Id),
});
const Steer = z.strictObject({
  type: z.literal("chat.message.steer.request"),
  ...mutation,
  messageId: Id,
  content: Content,
  botId: Id,
  agentId: Id,
  expectedTurnId: Id,
});
const Fetch = z.strictObject({ type: z.literal("chat.queue.fetch.request"), ...commandBase });
export const Command = z.discriminatedUnion("type", [Enqueue, Edit, Cancel, Reorder, Steer, Fetch]);
const Snapshot = z.strictObject({
  chatId: Id,
  revision: Counter,
  orderedMessageIds: z.array(Id),
  entries: z.array(Entry),
});
const responseBase = { requestId: Id, chatId: Id };
const MutationPayload = z.strictObject({ ...responseBase, mutationId: Id, result: CommandResult });
const SteerResult = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("applied"),
    delivery: Delivery,
    transcript: z.strictObject({ messageId: Id, seq: Sequence }),
    duplicate: z.boolean(),
  }),
  z.strictObject({ status: z.literal("rejected"), error: Error }),
  z.strictObject({ status: z.literal("unknown"), messageId: Id, error: Error }),
]);
const Discussion = z.strictObject({
  discussionId: Id,
  generation: Sequence,
  triggerMessageIds: z.array(Id).min(1),
  mode: z.enum(["open", "addressed"]),
  round: z.number().int().min(1).max(20),
  roundsMax: z.number().int().min(1).max(20),
  spoke: z.boolean(),
  waitingBotIds: z.array(Id),
  current: z
    .discriminatedUnion("state", [
      z.strictObject({ state: z.literal("claimed"), botId: Id, lease: Lease, clientMessageId: Id }),
      z.strictObject({ state: z.literal("running"), botId: Id, delivery: Delivery }),
      z.strictObject({ state: z.literal("unknown"), botId: Id, claimId: Id, clientMessageId: Id }),
    ])
    .nullable(),
});
// Trusted receipts are retained once and updated by mutationId; never appended
// as the entire accumulated array at every queue mutation.
const CommandReceipt = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("queue"),
    mutationId: Id,
    commandDigest: Digest,
    actor: SessionActorSchema,
    recordedAt: Time,
    commandType: z.enum([
      "chat.message.enqueue.request",
      "chat.message.edit.request",
      "chat.message.cancel.request",
      "chat.queue.reorder.request",
    ]),
    commandRef: ContentReference,
    result: CommandResult,
  }),
  z.strictObject({
    kind: z.literal("steer"),
    mutationId: Id,
    commandDigest: Digest,
    actor: SessionActorSchema,
    recordedAt: Time,
    commandType: z.literal("chat.message.steer.request"),
    commandRef: ContentReference,
    result: z.discriminatedUnion("status", [
      z.strictObject({ status: z.literal("pending"), messageId: Id, lease: Lease }),
      ...SteerResult.options,
    ]),
  }),
]);
// Full folded state for inspection/recovery, NOT one value per journal append.
// This is rebuildable from immutable transaction frames; index loss is safe.
export const Record = z.strictObject({
  recordVersion: z.literal(1),
  snapshot: Snapshot.extend({ entries: z.array(StoredEntry) }),
  nextQueueSeq: Sequence,
  discussion: Discussion.nullable(),
  commandReceipts: z.array(CommandReceipt),
});
// One transaction changes at most one entry and one receipt. Nullable order
// means unchanged; {value:null} clears discussion while null leaves it unchanged.
// Replay/CAS and ID upsert semantics belong to the Host, not JSON Schema.
const Transaction = z.strictObject({
  recordVersion: z.literal(1),
  chatId: Id,
  previousRevision: Counter,
  revision: Sequence,
  nextQueueSeq: Sequence,
  entry: StoredEntry.nullable(),
  commandReceipt: CommandReceipt.nullable(),
  orderedMessageIds: z.array(Id).max(128).nullable(),
  discussion: z.strictObject({ value: Discussion.nullable() }).nullable(),
});

export const Response = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("chat.message.enqueue.response"), payload: MutationPayload }),
  z.strictObject({ type: z.literal("chat.message.edit.response"), payload: MutationPayload }),
  z.strictObject({ type: z.literal("chat.message.cancel.response"), payload: MutationPayload }),
  z.strictObject({ type: z.literal("chat.queue.reorder.response"), payload: MutationPayload }),
  z.strictObject({
    type: z.literal("chat.message.steer.response"),
    payload: z.strictObject({ ...responseBase, mutationId: Id, result: SteerResult }),
  }),
  z.strictObject({
    type: z.literal("chat.queue.fetch.response"),
    payload: z.strictObject({
      ...responseBase,
      result: z.discriminatedUnion("status", [
        z.strictObject({ status: z.literal("ok"), snapshot: Snapshot }),
        z.strictObject({ status: z.literal("rejected"), error: Error }),
      ]),
    }),
  }),
]);
export const Event = z.strictObject({
  type: z.literal("chat.queue.updated"),
  payload: z.strictObject({
    subscriptionId: Id.optional(),
    snapshot: Snapshot,
  }),
});
// Proposed fifth stream family in existing SessionEventLog; current kinds do
// not include chat_queue. This is an explicit owner-review extension, not live code.
export const Journal = z.strictObject({
  kind: z.literal("chat_queue"),
  epoch: Id,
  seq: Sequence,
  value: Transaction,
  operation: z
    .strictObject({
      order: Sequence,
      timestamp: Time,
      actor: SessionActorSchema.optional(),
      channel: SessionChannelReferenceSchema.optional(),
    })
    .optional(),
});
// Client-only retry identity, never a Host-accepted queue item. localPayloadId
// points to an immutable Command-shaped local payload using existing draft/file
// storage; subjectScope scopes the cache, not authorization sent to the Host.
export const Intent = z.strictObject({
  recordVersion: z.literal(1),
  hostId: Id,
  chatId: Id,
  subjectScope: Id,
  mutationId: Id,
  messageId: Id.nullable(),
  commandType: z.enum([
    "chat.message.enqueue.request",
    "chat.message.edit.request",
    "chat.message.cancel.request",
    "chat.queue.reorder.request",
    "chat.message.steer.request",
  ]),
  localPayloadId: Id,
  recordedAt: Time,
  phase: z.enum(["pending", "unknown"]),
});
export const contracts = {
  intent: Intent,
  record: Record,
  journal: Journal,
  content: Content,
  command: Command,
  response: Response,
  event: Event,
};
