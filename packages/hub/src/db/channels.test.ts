// COMPAT(clisbot-channels): targeted tests for the channel control plane tables
// (plan P3/P4/P5). Exercises the fork-owned query module against a migrated
// embedded (PGlite) database in a temp directory.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import {
  ChannelDeliveryRecordNotFoundError,
  ChannelStore,
  ChannelThreadBindingConflictError,
  ChannelThreadBindingNotFoundError,
} from "./channels.js";
import { embeddedDatabaseRuntime } from "./runtime/index.js";
import type { DatabaseRuntimeBundle } from "./runtime/index.js";

const ORGANIZATION_ID = "channel-org";
const SLACK_ACCOUNT = "work";
const TELEGRAM_ACCOUNT = "personal";
const SLACK_CONVERSATION = "C0APP";
const SLACK_THREAD = "1720000000.000000";
const TELEGRAM_CONVERSATION = "-1001234567890";
const TELEGRAM_TOPIC = "42";
const INITIATOR = "slack:U0ALICE";
const ROUTE = { agent: "worker-app", environment: "repo-app", sync: { finalAnswers: true } };

let dataDirectory: string;
let bundle: DatabaseRuntimeBundle;
let store: ChannelStore;

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-channel-db-"));
  bundle = await embeddedDatabaseRuntime(dataDirectory);
  await bundle.runtime.migrate();
  await bundle.runtime.query(
    `insert into organization (id, name, slug) values ($1, 'Channel Org', 'channel-org')`,
    [ORGANIZATION_ID],
  );
  store = new ChannelStore(bundle.runtime);
}, 60_000);

afterAll(async () => {
  await bundle.runtime.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("thread_bindings", () => {
  it("records a pending marker, resolves it, and round-trips the binding", async () => {
    const pending = await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: SLACK_ACCOUNT,
      externalConversationId: SLACK_CONVERSATION,
      externalThreadId: SLACK_THREAD,
      pendingExecutionId: "execution-1",
      initiator: INITIATOR,
      route: ROUTE,
    });
    assert.equal(pending.status, "pending");
    assert.equal(pending.pendingExecutionId, "execution-1");
    assert.equal(pending.agentId, null);
    assert.equal(pending.resolvedAt, null);

    const replayed = await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: SLACK_ACCOUNT,
      externalConversationId: SLACK_CONVERSATION,
      externalThreadId: SLACK_THREAD,
      pendingExecutionId: "execution-1",
      initiator: INITIATOR,
      route: ROUTE,
    });
    assert.equal(replayed.id, pending.id, "a replayed create reuses the stored marker");

    const bound = await store.resolvePendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      accountId: SLACK_ACCOUNT,
      externalConversationId: SLACK_CONVERSATION,
      externalThreadId: SLACK_THREAD,
      agentId: "agent-42",
      resolvedAt: new Date("2026-08-25T01:00:00Z"),
    });
    assert.equal(bound.status, "bound");
    assert.equal(bound.agentId, "agent-42");
    assert.equal(bound.pendingExecutionId, null);
    assert.equal(bound.resolvedAt?.toISOString(), "2026-08-25T01:00:00.000Z");
    assert.equal(bound.initiator, INITIATOR);
    assert.deepEqual(bound.route, ROUTE);

    const found = await store.findThreadBinding(
      ORGANIZATION_ID,
      SLACK_ACCOUNT,
      SLACK_CONVERSATION,
      SLACK_THREAD,
    );
    assert.ok(found !== undefined);
    assert.equal(found?.agentId, "agent-42");
  });

  it("rejects a second pending marker for a bound thread key", async () => {
    await assert.rejects(
      store.recordPendingThreadBinding({
        organizationId: ORGANIZATION_ID,
        channel: "slack",
        accountId: SLACK_ACCOUNT,
        externalConversationId: SLACK_CONVERSATION,
        externalThreadId: SLACK_THREAD,
        pendingExecutionId: "execution-2",
        initiator: INITIATOR,
        route: ROUTE,
      }),
      ChannelThreadBindingConflictError,
    );
  });

  it("rejects resolving a marker with a different execution id", async () => {
    await assert.rejects(
      store.resolvePendingThreadBinding({
        organizationId: ORGANIZATION_ID,
        accountId: SLACK_ACCOUNT,
        externalConversationId: SLACK_CONVERSATION,
        externalThreadId: null,
        agentId: "agent-42",
        resolvedAt: new Date(),
      }),
      ChannelThreadBindingNotFoundError,
    );
  });

  it("keeps one binding per thread key across channel levels", async () => {
    const channelLevel = await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: SLACK_ACCOUNT,
      externalConversationId: SLACK_CONVERSATION,
      externalThreadId: null,
      pendingExecutionId: "execution-3",
      initiator: INITIATOR,
      route: ROUTE,
    });
    const threadLevel = await store.findThreadBinding(
      ORGANIZATION_ID,
      SLACK_ACCOUNT,
      SLACK_CONVERSATION,
      SLACK_THREAD,
    );
    assert.equal(channelLevel.externalThreadId, null);
    assert.ok(threadLevel !== undefined);
    assert.notEqual(channelLevel.id, threadLevel.id, "channel and thread levels are distinct");

    const channelReplay = await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: SLACK_ACCOUNT,
      externalConversationId: SLACK_CONVERSATION,
      externalThreadId: null,
      pendingExecutionId: "execution-3",
      initiator: INITIATOR,
      route: ROUTE,
    });
    assert.equal(channelReplay.id, channelLevel.id, "a null-thread binding is deduplicated");
  });

  it("lists pending markers for orphan recovery", async () => {
    const telegramPending = await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "telegram",
      accountId: TELEGRAM_ACCOUNT,
      externalConversationId: TELEGRAM_CONVERSATION,
      externalThreadId: TELEGRAM_TOPIC,
      pendingExecutionId: "execution-9",
      initiator: "telegram:123456789",
      route: ROUTE,
    });
    const abandoned = await store.abandonPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      accountId: TELEGRAM_ACCOUNT,
      externalConversationId: TELEGRAM_CONVERSATION,
      externalThreadId: TELEGRAM_TOPIC,
      resolvedAt: new Date("2026-08-25T02:00:00Z"),
    });
    assert.equal(abandoned.status, "abandoned");

    const pending = await store.listPendingThreadBindings(ORGANIZATION_ID);
    assert.deepEqual(pending.map(({ pendingExecutionId }) => pendingExecutionId).toSorted(), [
      "execution-3",
    ]);
    assert.equal(telegramPending.status, "pending");
  });
});

describe("delivery_ledger", () => {
  const key = {
    organizationId: ORGANIZATION_ID,
    channel: "slack" as const,
    accountId: SLACK_ACCOUNT,
    externalConversationId: SLACK_CONVERSATION,
    externalThreadId: SLACK_THREAD,
  };

  it("records before posting and dedupes replays on the same key", async () => {
    const first = await store.recordDelivery({ ...key, eventTurnId: "turn-1", sequence: 0 });
    assert.equal(first.created, true);
    assert.equal(first.record.status, "recorded");
    assert.equal(first.record.externalMessageId, null);

    const replay = await store.recordDelivery({ ...key, eventTurnId: "turn-1", sequence: 0 });
    assert.equal(replay.created, false, "a replayed stream event must not re-record");
    assert.equal(replay.record.id, first.record.id);

    const next = await store.recordDelivery({ ...key, eventTurnId: "turn-1", sequence: 1 });
    assert.equal(next.created, true, "a new sequence in the same turn is a new attempt");
  });

  it("dedupes root-conversation deliveries where the thread id is null", async () => {
    const rootKey = {
      ...key,
      channel: "telegram" as const,
      accountId: TELEGRAM_ACCOUNT,
      externalConversationId: TELEGRAM_CONVERSATION,
      externalThreadId: null,
    };
    const first = await store.recordDelivery({
      ...rootKey,
      eventTurnId: "telegram-root-turn",
      sequence: 0,
    });
    const replay = await store.recordDelivery({
      ...rootKey,
      eventTurnId: "telegram-root-turn",
      sequence: 0,
    });

    assert.equal(first.created, true);
    assert.equal(replay.created, false);
    assert.equal(replay.record.id, first.record.id);
  });

  it("confirms a delivery and idempotently re-confirms it", async () => {
    const recorded = await store.recordDelivery({ ...key, eventTurnId: "turn-1", sequence: 0 });
    const posted = await store.confirmDelivery({
      organizationId: ORGANIZATION_ID,
      accountId: SLACK_ACCOUNT,
      externalConversationId: SLACK_CONVERSATION,
      externalThreadId: SLACK_THREAD,
      eventTurnId: "turn-1",
      sequence: 0,
      externalMessageId: "1720000000.000001",
      postedAt: new Date("2026-08-25T03:00:00Z"),
    });
    assert.equal(posted.status, "posted");
    assert.equal(posted.externalMessageId, "1720000000.000001");

    const again = await store.confirmDelivery({
      organizationId: ORGANIZATION_ID,
      accountId: SLACK_ACCOUNT,
      externalConversationId: SLACK_CONVERSATION,
      externalThreadId: SLACK_THREAD,
      eventTurnId: "turn-1",
      sequence: 0,
      externalMessageId: "1720000000.000002",
      postedAt: new Date("2026-08-25T03:00:01Z"),
    });
    assert.equal(again.id, posted.id, "re-confirm returns the stored row");
    assert.equal(again.externalMessageId, "1720000000.000001");

    const found = await store.findDeliveryLedgerRecord(
      ORGANIZATION_ID,
      SLACK_ACCOUNT,
      "out",
      SLACK_CONVERSATION,
      SLACK_THREAD,
      "turn-1",
      0,
    );
    assert.equal(found?.status, "posted");
    assert.equal(recorded.record.status, "recorded");

    const listed = await store.listPostedDeliveries(
      ORGANIZATION_ID,
      SLACK_ACCOUNT,
      SLACK_CONVERSATION,
      SLACK_THREAD,
    );
    assert.deepEqual(
      listed.map(({ eventTurnId, sequence }) => `${eventTurnId}:${sequence}`),
      ["turn-1:0"],
    );
  });

  it("marks a recorded delivery as failed and re-arms it for a later post", async () => {
    const recorded = await store.recordDelivery({ ...key, eventTurnId: "turn-2", sequence: 0 });
    assert.equal(recorded.record.status, "recorded");

    const failed = await store.failDelivery({
      organizationId: ORGANIZATION_ID,
      accountId: SLACK_ACCOUNT,
      externalConversationId: SLACK_CONVERSATION,
      externalThreadId: SLACK_THREAD,
      eventTurnId: "turn-2",
      sequence: 0,
      failureReason: "rate limited",
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.failureReason, "rate limited");
    assert.equal(failed.attempts, 1);
    assert.equal(failed.externalMessageId, null, "a failed post has no native id yet");

    // The row is not "posted", so it does not count toward the replay cursor.
    const listed = await store.listPostedDeliveries(
      ORGANIZATION_ID,
      SLACK_ACCOUNT,
      SLACK_CONVERSATION,
      SLACK_THREAD,
    );
    assert.ok(
      !listed.some(({ eventTurnId, sequence }) => eventTurnId === "turn-2" && sequence === 0),
      "a failed delivery is not a posted delivery",
    );

    const retry = await store.recordDelivery({ ...key, eventTurnId: "turn-2", sequence: 0 });
    assert.equal(retry.created, true, "a known failed handoff is safe to retry");
    assert.equal(retry.record.id, failed.id);
    assert.equal(retry.record.status, "recorded");
    assert.equal(retry.record.attempts, 2);

    // A later retry confirms the same record — the ledger does not need a new row.
    const posted = await store.confirmDelivery({
      organizationId: ORGANIZATION_ID,
      accountId: SLACK_ACCOUNT,
      externalConversationId: SLACK_CONVERSATION,
      externalThreadId: SLACK_THREAD,
      eventTurnId: "turn-2",
      sequence: 0,
      externalMessageId: "1720000000.000003",
      postedAt: new Date("2026-08-25T03:00:02Z"),
    });
    assert.equal(posted.id, failed.id, "the retry reuses the failed record");
    assert.equal(posted.status, "posted");
    assert.equal(posted.externalMessageId, "1720000000.000003");
    assert.equal(posted.failureReason, null, "confirming clears the failure reason");
  });

  it("leaves a recorded delivery stuck (recorded, never confirmed) until acted on", async () => {
    const recorded = await store.recordDelivery({ ...key, eventTurnId: "turn-3", sequence: 0 });
    assert.equal(recorded.created, true);
    assert.equal(recorded.record.status, "recorded");

    // Nothing confirms or fails it: it stays "recorded" with no native id.
    const found = await store.findDeliveryLedgerRecord(
      ORGANIZATION_ID,
      SLACK_ACCOUNT,
      "out",
      SLACK_CONVERSATION,
      SLACK_THREAD,
      "turn-3",
      0,
    );
    assert.equal(found?.status, "recorded");
    assert.equal(found?.externalMessageId, null);

    // It is not posted, so the replay cursor does not advance past it.
    const listed = await store.listPostedDeliveries(
      ORGANIZATION_ID,
      SLACK_ACCOUNT,
      SLACK_CONVERSATION,
      SLACK_THREAD,
    );
    assert.ok(
      !listed.some(({ eventTurnId, sequence }) => eventTurnId === "turn-3" && sequence === 0),
      "a stuck delivery is not a posted delivery",
    );
  });

  it("fails the delivery ledger on a record that was never recorded", async () => {
    await assert.rejects(
      store.failDelivery({
        organizationId: ORGANIZATION_ID,
        accountId: SLACK_ACCOUNT,
        externalConversationId: SLACK_CONVERSATION,
        externalThreadId: SLACK_THREAD,
        eventTurnId: "turn-none",
        sequence: 0,
        failureReason: "rate limited",
      }),
      ChannelDeliveryRecordNotFoundError,
    );
  });
});

describe("delivery_ledger inbound (direction = 'in')", () => {
  const inbound = {
    organizationId: ORGANIZATION_ID,
    channel: "telegram" as const,
    accountId: TELEGRAM_ACCOUNT,
    externalConversationId: TELEGRAM_CONVERSATION,
  };

  it("records an inbound event once; a replayed event does not create a second row", async () => {
    const first = await store.recordInbound({ ...inbound, externalMessageId: "1001" });
    assert.equal(first.created, true);
    assert.equal(first.record.direction, "in");
    assert.equal(first.record.status, "recorded");
    assert.equal(first.record.externalMessageId, "1001");
    assert.equal(first.record.eventTurnId, "");
    assert.equal(first.record.sequence, 0);
    assert.equal(first.record.turnId, null);

    const replay = await store.recordInbound({ ...inbound, externalMessageId: "1001" });
    assert.equal(replay.created, false, "a transport replay must not re-record");
    assert.equal(replay.record.id, first.record.id);
  });

  it("consumes an inbound row, referencing the plane turn; re-consume is a no-op", async () => {
    await store.recordInbound({ ...inbound, externalMessageId: "1002" });
    const consumed = await store.consumeInbound({
      organizationId: ORGANIZATION_ID,
      accountId: TELEGRAM_ACCOUNT,
      externalConversationId: TELEGRAM_CONVERSATION,
      externalMessageId: "1002",
      turnId: "telegram:1002",
      consumedAt: new Date("2026-08-25T04:00:00Z"),
    });
    assert.equal(consumed.status, "consumed");
    assert.equal(consumed.turnId, "telegram:1002");
    assert.ok(consumed.consumedAt instanceof Date);

    const again = await store.consumeInbound({
      organizationId: ORGANIZATION_ID,
      accountId: TELEGRAM_ACCOUNT,
      externalConversationId: TELEGRAM_CONVERSATION,
      externalMessageId: "1002",
      turnId: "telegram:other-turn",
      consumedAt: new Date("2026-08-25T04:00:01Z"),
    });
    assert.equal(again.id, consumed.id, "re-consume returns the stored row");
    assert.equal(again.turnId, "telegram:1002", "the first turn reference wins");
  });

  it("keeps a declined inbound row at 'recorded' until it is consumed", async () => {
    await store.recordInbound({ ...inbound, externalMessageId: "1003" });
    const found = await store.findDeliveryLedgerRecord(
      ORGANIZATION_ID,
      TELEGRAM_ACCOUNT,
      "in",
      TELEGRAM_CONVERSATION,
      null,
      "",
      0,
    );
    assert.equal(found?.status, "recorded", "the plane declined it; it stays recorded");
    assert.equal(found?.turnId, null);

    // Inbound rows never enter the outbound replay cursor.
    const listed = await store.listPostedDeliveries(
      ORGANIZATION_ID,
      TELEGRAM_ACCOUNT,
      TELEGRAM_CONVERSATION,
      null,
    );
    assert.equal(listed.length, 0);
  });

  it("rejects consuming an inbound message that was never recorded", async () => {
    await assert.rejects(
      store.consumeInbound({
        organizationId: ORGANIZATION_ID,
        accountId: TELEGRAM_ACCOUNT,
        externalConversationId: TELEGRAM_CONVERSATION,
        externalMessageId: "4004",
        turnId: "telegram:4004",
        consumedAt: new Date(),
      }),
      ChannelDeliveryRecordNotFoundError,
    );
  });
});
