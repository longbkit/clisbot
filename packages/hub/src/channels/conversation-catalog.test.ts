import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, it } from "vitest";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";
import { listObservedChannelConversations } from "./conversation-catalog.js";

const ORGANIZATION_ID = "conversation-catalog-org";
let dataDirectory: string;
let bundle: DatabaseRuntimeBundle;

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-conversation-catalog-"));
  bundle = await embeddedDatabaseRuntime(dataDirectory);
  await bundle.runtime.migrate();
  await bundle.runtime.drizzle().insert(schema.organizations).values({
    id: ORGANIZATION_ID,
    name: "Conversation Catalog Org",
    slug: ORGANIZATION_ID,
  });
}, 60_000);

afterAll(async () => {
  await bundle.runtime.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

it("projects direct-Agent bindings and Workflow receipts into one scoped catalog", async () => {
  await bundle.runtime
    .drizzle()
    .insert(schema.threadBindings)
    .values({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: "support",
      externalConversationId: "C-SUPPORT",
      externalThreadId: "1700000000.000100",
      status: "bound",
      pendingExecutionId: null,
      agentId: "agent-1",
      daemonId: null,
      initiator: "slack:U-1",
      route: {
        match: { kind: "thread", id: "1700000000.000100" },
        conversationLabel: "  #support  ",
      },
      createdAt: new Date("2026-09-01T10:00:00Z"),
      resolvedAt: new Date("2026-09-01T10:00:01Z"),
    });
  await bundle.runtime
    .drizzle()
    .insert(schema.providerEventReceipts)
    .values([
      {
        organizationId: ORGANIZATION_ID,
        provider: "channel",
        deliveryId: "slack:support:message-1",
        source: "channel.message",
        receivedAt: new Date("2026-09-02T10:00:00Z"),
        payload: workflowPayload("support", "C-SUPPORT", "1700000000.000200", "#support"),
      },
      {
        organizationId: ORGANIZATION_ID,
        provider: "channel",
        deliveryId: "slack:other:message-1",
        source: "channel.message",
        receivedAt: new Date("2026-09-03T10:00:00Z"),
        payload: workflowPayload("other", "C-OTHER", null, "#other"),
      },
    ]);

  const conversations = await listObservedChannelConversations(bundle.runtime, {
    organizationId: ORGANIZATION_ID,
    channel: "slack",
    accountId: "support",
  });

  assert.deepEqual(
    conversations.map(({ id, kind, rootConversationId, label, visibility }) => ({
      id,
      kind,
      rootConversationId,
      label,
      visibility,
    })),
    [
      {
        id: "C-SUPPORT",
        kind: "channel",
        rootConversationId: "C-SUPPORT",
        label: "#support",
        visibility: "unknown",
      },
      {
        id: "1700000000.000200",
        kind: "thread",
        rootConversationId: "C-SUPPORT",
        label: "#support",
        visibility: "unknown",
      },
      {
        id: "1700000000.000100",
        kind: "thread",
        rootConversationId: "C-SUPPORT",
        label: "#support",
        visibility: "unknown",
      },
    ],
  );
});

it("lists every room the bot has seen in the ingress queue, with the visibility it reported", async () => {
  const row = (id: string, ctxPayload: Record<string, unknown>, at: string, thread?: string) => ({
    organizationId: ORGANIZATION_ID,
    channel: "telegram",
    accountId: "ops",
    externalEventId: `update:${id}`,
    externalMessageId: id,
    externalConversationId: String(ctxPayload["ChatId"]),
    ...(thread === undefined ? {} : { externalThreadId: thread }),
    laneKey: `telegram:ops:${String(ctxPayload["ChatId"])}`,
    payload: { channel: "telegram", accountId: "ops", ctxPayload },
    status: "completed" as const,
    createdAt: new Date(at),
  });
  await bundle.runtime
    .drizzle()
    .insert(schema.channelIngressQueue)
    .values([
      row(
        "1",
        { ChatId: "-100", ChatType: "group", ConversationLabel: "QC", Visibility: "public" },
        "2026-09-04T10:00:00Z",
        "7",
      ),
      row("2", { ChatId: "42", ChatType: "direct", SenderName: "Hoa" }, "2026-09-05T10:00:00Z"),
      row(
        "3",
        { ChatId: "-200", ChatType: "group", ConversationLabel: "Private" },
        "2026-09-03T10:00:00Z",
      ),
    ]);

  const conversations = await listObservedChannelConversations(bundle.runtime, {
    organizationId: ORGANIZATION_ID,
    channel: "telegram",
    accountId: "ops",
  });

  assert.deepEqual(
    conversations.map(({ id, kind, label, visibility }) => ({ id, kind, label, visibility })),
    [
      { id: "42", kind: "dm", label: "Hoa", visibility: "private" },
      { id: "-100", kind: "group", label: "QC", visibility: "public" },
      { id: "7", kind: "topic", label: "QC", visibility: "public" },
      { id: "-200", kind: "group", label: "Private", visibility: "unknown" },
    ],
  );
});

function workflowPayload(
  accountId: string,
  conversationId: string,
  threadId: string | null,
  label: string,
) {
  return {
    workflow: "triage",
    workflow_id: "11111111-1111-4111-8111-111111111111",
    workflow_revision_id: "22222222-2222-4222-8222-222222222222",
    text: "Please triage",
    channel: {
      name: "slack",
      account_id: accountId,
      binding_key: JSON.stringify(["slack", accountId, conversationId, threadId]),
      external_conversation_id: conversationId,
      external_thread_id: threadId,
      conversation_label: label,
      sender_identity: "slack:U-1",
      root_kind: "channel",
      trigger_thread_id: threadId,
      route: {
        defaultRoles: [],
        assignments: [],
        defaults: {},
        approval: [],
      },
    },
  };
}
