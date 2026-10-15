import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
// Zod uses standards-valid numeric constraints alongside a $ref that supplies
// the numeric type. Ajv's strictTypes lint cannot infer that referenced type.
const ajv = new Ajv2020({
  strict: true,
  strictTypes: false,
  allErrors: true,
  validateFormats: true,
});
addFormats(ajv, { mode: "full" });
const validators = {};
for (const name of ["record", "journal", "content", "intent", "command", "response", "event"]) {
  const schema = JSON.parse(await readFile(new URL(`./${name}.schema.json`, import.meta.url)));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(ajv.validateSchema(schema), true);
  validators[name] = ajv.compile(schema); // Every local ref must resolve here.
  console.log(`COMPILED ${name} draft-2020-12; format assertions ON; refs resolved`);
}
const at = "2026-10-14T10:00:00.000Z";
const actor = { kind: "user", id: "owner" };
const content = { text: "@alpha inspect this", images: [], attachments: [] };
const receipt = { messageId: "msg-example", queueSeq: 1, acceptedAt: at, acceptedRevision: 1 };
const lease = {
  claimId: "claim-example",
  hostBootId: "boot-example",
  expiresAt: "2026-10-14T10:01:00.000Z",
  attempt: 1,
};
const delivery = {
  botId: "bot-example",
  agentId: "agent-example",
  clientMessageId: "msg-example",
  disposition: "steered",
  turnId: "turn-example",
  submittedRow: { epoch: "epoch-example", seq: 2 },
};
const entry = {
  receipt,
  revision: 1,
  content,
  contentDigest: "a".repeat(64),
  actor,
  audience: { kind: "direct", botId: "bot-example" },
  outcome: { state: "queued" },
};
const snapshot = {
  chatId: "cht_example",
  revision: 1,
  orderedMessageIds: ["msg-example"],
  entries: [entry],
};
function immutableReference(value) {
  const bytes = JSON.stringify(value);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { relativePath: `queue-content/${sha256}.json`, size: Buffer.byteLength(bytes), sha256 };
}
const contentRef = immutableReference(content);
const { content: _content, ...entryMetadata } = entry;
const storedEntry = { ...entryMetadata, contentRef };
const storedSnapshot = { ...snapshot, entries: [storedEntry] };
const base = {
  requestId: "request-example",
  chatId: "cht_example",
  mutationId: "mutation-example",
};
const enqueue = {
  type: "chat.message.enqueue.request",
  ...base,
  messageId: "msg-example",
  content,
};
const accepted = { status: "accepted", revision: 1, receipt, duplicate: false };
const rejected = {
  status: "rejected",
  revision: 1,
  error: { code: "conflict", message: "Queue changed; fetch its current revision" },
};
const applied = {
  status: "applied",
  delivery,
  transcript: { messageId: "msg-example", seq: 3 },
  duplicate: false,
};
const examples = [];
function valid(name, schema, value) {
  examples.push({ name, schema, valid: true, value });
}
function invalid(name, schema, value, expectedKeyword, expectedProperty) {
  examples.push({ name, schema, valid: false, expectedKeyword, expectedProperty, value });
}
valid("immutable input payload", "content", content);
invalid(
  "blob payload cannot forge actor",
  "content",
  { ...content, actor },
  "additionalProperties",
);
const intent = {
  recordVersion: 1,
  hostId: "srv_example",
  chatId: "cht_example",
  subjectScope: "owner-local",
  mutationId: base.mutationId,
  messageId: "msg-example",
  commandType: "chat.message.enqueue.request",
  localPayloadId: "local-payload-example",
  recordedAt: at,
  phase: "pending",
};
valid("client pending identity is not Host accepted", "intent", intent);
valid("client unknown survives browser close", "intent", { ...intent, phase: "unknown" });
invalid(
  "client intent cannot claim Host accepted",
  "intent",
  { ...intent, phase: "accepted" },
  "enum",
);
invalid(
  "intent missing immutable payload identity",
  "intent",
  { ...intent, localPayloadId: undefined },
  "required",
  "localPayloadId",
);
valid("enqueue opaque ID", "command", enqueue);
valid("edit text, file, mention and reply context", "command", {
  type: "chat.message.edit.request",
  ...base,
  expectedRevision: 1,
  expectedEntryRevision: 1,
  messageId: "msg-example",
  content: {
    text: "new mention @alpha",
    images: [
      {
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl4Kj8AAAAASUVORK5CYII=",
        mimeType: "image/png",
      },
    ],
    attachments: [
      {
        type: "text",
        mimeType: "text/plain",
        title: "reply context",
        text: "quoted context",
        sourceSession: { agentId: "agent-example", epoch: "epoch-example", seq: 1 },
      },
    ],
  },
});
valid("cancel", "command", {
  type: "chat.message.cancel.request",
  ...base,
  expectedRevision: 1,
  expectedEntryRevision: 1,
  messageId: "msg-example",
});
valid("reorder", "command", {
  type: "chat.queue.reorder.request",
  ...base,
  expectedRevision: 1,
  messageIds: ["msg-example"],
});
const steer = {
  type: "chat.message.steer.request",
  ...base,
  messageId: "msg-example",
  content,
  botId: "bot-example",
  agentId: "agent-example",
  expectedTurnId: "turn-example",
};
valid("steer exact turn", "command", steer);
valid("fetch", "command", {
  type: "chat.queue.fetch.request",
  requestId: "request-example",
  chatId: "cht_example",
});
const record = {
  recordVersion: 1,
  snapshot: storedSnapshot,
  nextQueueSeq: 2,
  discussion: null,
  commandReceipts: [
    {
      kind: "queue",
      mutationId: base.mutationId,
      commandDigest: "b".repeat(64),
      actor,
      recordedAt: at,
      commandType: enqueue.type,
      commandRef: immutableReference(enqueue),
      result: accepted,
    },
  ],
};
valid("durable queued record", "record", record);
for (const outcome of [
  { state: "claimed", lease },
  {
    state: "applied",
    transcript: { messageId: "msg-example", seq: 3 },
    deliveries: [delivery],
    appliedAt: at,
  },
  { state: "canceled", canceledAt: at },
  { state: "failed", failedAt: at, code: "access_revoked", detail: "Bot Project grant revoked" },
  {
    state: "unknown",
    claimId: "claim-example",
    observedAt: at,
    code: "provider_outcome_unknown",
    detail: "Provider may have accepted the input",
  },
])
  valid(`durable ${outcome.state}`, "record", {
    ...record,
    snapshot: { ...snapshot, entries: [{ ...storedEntry, outcome }], orderedMessageIds: [] },
  });
const transaction = {
  recordVersion: 1,
  chatId: snapshot.chatId,
  previousRevision: 0,
  revision: 1,
  nextQueueSeq: 2,
  entry: storedEntry,
  commandReceipt: record.commandReceipts[0],
  orderedMessageIds: [receipt.messageId],
  discussion: null,
};
const journal = {
  kind: "chat_queue",
  epoch: "epoch-example",
  seq: 1,
  value: transaction,
  operation: { order: 1, timestamp: at, actor },
};
valid("durable journal framing, one transaction not all retained state", "journal", journal);
valid("discussion reset transaction", "journal", {
  ...journal,
  value: {
    ...transaction,
    entry: null,
    commandReceipt: null,
    orderedMessageIds: null,
    discussion: { value: null },
  },
});
invalid(
  "full checkpoint is not a transaction",
  "journal",
  { ...journal, value: record },
  "additionalProperties",
);
invalid(
  "transaction missing previous revision",
  "journal",
  { ...journal, value: { ...transaction, previousRevision: undefined } },
  "required",
  "previousRevision",
);
invalid(
  "order vector exceeds proposed pending bound",
  "journal",
  { ...journal, value: { ...transaction, orderedMessageIds: Array(129).fill("msg-example") } },
  "maxItems",
);
valid("timestamp milliseconds and offset", "record", {
  ...record,
  commandReceipts: [{ ...record.commandReceipts[0], recordedAt: "2026-10-14T17:00:00.123+07:00" }],
});
invalid(
  "journal value required",
  "journal",
  { kind: "chat_queue", epoch: "epoch-example", seq: 1 },
  "required",
  "value",
);
invalid(
  "journal seq cannot be zero",
  "journal",
  { kind: "chat_queue", epoch: "epoch-example", seq: 0, value: transaction },
  "minimum",
);
invalid(
  "timestamp requires seconds and milliseconds",
  "record",
  {
    ...record,
    commandReceipts: [{ ...record.commandReceipts[0], recordedAt: "2026-10-14T10:00Z" }],
  },
  "pattern",
);
valid("durable discussion worker", "record", {
  ...record,
  discussion: {
    discussionId: "discussion-example",
    generation: 1,
    triggerMessageIds: ["msg-example"],
    mode: "addressed",
    round: 1,
    roundsMax: 3,
    spoke: false,
    waitingBotIds: ["bot-next"],
    current: { state: "running", botId: "bot-example", delivery },
  },
});
valid("durable group audience", "record", {
  ...record,
  snapshot: {
    ...storedSnapshot,
    entries: [
      { ...storedEntry, audience: { kind: "group", mode: "addressed", botIds: ["bot-example"] } },
    ],
  },
});
valid("durable steer pending", "record", {
  ...record,
  commandReceipts: [
    {
      ...record.commandReceipts[0],
      kind: "steer",
      commandType: steer.type,
      commandRef: contentRef,
      result: { status: "pending", messageId: "msg-example", lease },
    },
  ],
});
for (const type of [
  "chat.message.enqueue.response",
  "chat.message.edit.response",
  "chat.message.cancel.response",
  "chat.queue.reorder.response",
]) {
  valid(`${type} accepted`, "response", { type, payload: { ...base, result: accepted } });
  valid(`${type} rejected`, "response", { type, payload: { ...base, result: rejected } });
}
for (const result of [
  applied,
  {
    status: "rejected",
    error: { code: "unsupported", message: "This provider cannot steer this exact active turn" },
  },
  {
    status: "unknown",
    messageId: "msg-example",
    error: { code: "outcome_unknown", message: "Do not retry provider side effects automatically" },
  },
])
  valid(`steer ${result.status}`, "response", {
    type: "chat.message.steer.response",
    payload: { ...base, result },
  });
valid("fetch ok", "response", {
  type: "chat.queue.fetch.response",
  payload: { requestId: base.requestId, chatId: base.chatId, result: { status: "ok", snapshot } },
});
valid("fetch rejected", "response", {
  type: "chat.queue.fetch.response",
  payload: {
    requestId: base.requestId,
    chatId: base.chatId,
    result: { status: "rejected", error: rejected.error },
  },
});
valid("queue event", "event", { type: "chat.queue.updated", payload: { snapshot } });
invalid("client forges actor", "command", { ...enqueue, actor }, "additionalProperties");
invalid(
  "client forges recipient list",
  "command",
  { ...enqueue, audience: entry.audience },
  "additionalProperties",
);
invalid(
  "missing messageId",
  "command",
  { ...enqueue, messageId: undefined },
  "required",
  "messageId",
);
invalid("empty opaque ID", "command", { ...enqueue, messageId: "" }, "minLength");
invalid(
  "unsupported operation",
  "command",
  { ...enqueue, type: "chat.message.magic.request" },
  "const",
);
invalid("unsafe sequence", "record", { ...record, nextQueueSeq: 9007199254740992 }, "maximum");
invalid(
  "negative revision",
  "command",
  { type: "chat.queue.reorder.request", ...base, expectedRevision: -1, messageIds: [] },
  "minimum",
);
invalid(
  "nonintegral revision",
  "command",
  { type: "chat.queue.reorder.request", ...base, expectedRevision: 1.5, messageIds: [] },
  "type",
);
invalid(
  "invalid RFC3339 time",
  "record",
  {
    ...record,
    commandReceipts: [{ ...record.commandReceipts[0], recordedAt: "2026-02-30T10:00:00Z" }],
  },
  "format",
);
invalid(
  "time has no offset",
  "record",
  {
    ...record,
    commandReceipts: [{ ...record.commandReceipts[0], recordedAt: "2026-10-14T10:00:00" }],
  },
  "pattern",
);
invalid(
  "invalid queue state",
  "record",
  {
    ...record,
    snapshot: { ...snapshot, entries: [{ ...storedEntry, outcome: { state: "draft" } }] },
  },
  "const",
);
invalid(
  "claimed without lease",
  "record",
  {
    ...record,
    snapshot: { ...snapshot, entries: [{ ...storedEntry, outcome: { state: "claimed" } }] },
  },
  "required",
  "lease",
);
invalid(
  "unknown without reason",
  "record",
  {
    ...record,
    snapshot: {
      ...storedSnapshot,
      entries: [
        { ...storedEntry, outcome: { state: "unknown", claimId: "claim-example", observedAt: at } },
      ],
    },
  },
  "required",
  "code",
);
invalid(
  "steer lacks exact turn",
  "command",
  { ...steer, expectedTurnId: undefined },
  "required",
  "expectedTurnId",
);
invalid(
  "response missing settlement",
  "response",
  { type: "chat.message.enqueue.response", payload: base },
  "required",
  "result",
);
invalid(
  "event cannot carry command receipts",
  "event",
  { type: "chat.queue.updated", payload: { snapshot, commandReceipts: record.commandReceipts } },
  "additionalProperties",
);
invalid(
  "nullable receipt required",
  "response",
  {
    type: "chat.queue.reorder.response",
    payload: { ...base, result: { ...accepted, receipt: undefined } },
  },
  "required",
  "receipt",
);
await writeFile(
  new URL("./examples.json", import.meta.url),
  JSON.stringify(examples, null, 2) + "\n",
);
execFileSync(
  "npm",
  ["run", "format:files", "--", fileURLToPath(new URL("./examples.json", import.meta.url))],
  {
    cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
    stdio: "inherit",
  },
);
let passed = 0;
for (const example of examples) {
  const value = JSON.parse(JSON.stringify(example.value));
  const validate = validators[example.schema];
  assert.equal(validate(value), example.valid, example.name);
  if (!example.valid) {
    assert.equal(
      validate.errors.some((error) => error.keyword === example.expectedKeyword),
      true,
      example.name,
    );
    const failure = validate.errors.find(
      (error) =>
        error.keyword === example.expectedKeyword &&
        (!example.expectedProperty || error.params.missingProperty === example.expectedProperty),
    );
    assert.ok(failure, example.name);
    console.log(
      `REJECT ${example.name}: ${failure.instancePath || "/"} ${failure.keyword} ${failure.message}`,
    );
  } else console.log(`VALID ${example.name}`);
  passed++;
}
console.log(
  `PASS ${passed}/${examples.length}; ${examples.filter((e) => e.valid).length} valid, ${examples.filter((e) => !e.valid).length} invalid`,
);
