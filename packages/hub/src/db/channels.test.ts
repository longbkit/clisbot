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

describe("channel activity", () => {
  it("persists bounded open-audience evidence in the shared audit trail", async () => {
    await store.recordChannelInboundActivity({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: SLACK_ACCOUNT,
      routePosition: 1,
      routeFingerprint: "route-fingerprint",
      externalConversationId: SLACK_CONVERSATION,
      externalThreadId: SLACK_THREAD,
      senderIdentity: "slack:U0EXTERNAL",
      outcome: "ignored",
      outcomeDetail: "Route rate limit exceeded",
      limitDecision: "denied",
      limitReason: "Route rate limit exceeded",
    });

    const rows = await bundle.runtime.query<{
      action: string;
      subject_type: string;
      subject_id: string;
      evidence: Record<string, unknown>;
    }>(
      `select action, subject_type, subject_id, evidence
       from audit_events
       where organization_id = $1 and action = 'channel.inbound.processed'
       order by created_at desc limit 1`,
      [ORGANIZATION_ID],
    );
    assert.deepEqual(rows.rows[0], {
      action: "channel.inbound.processed",
      subject_type: "channel_account",
      subject_id: "slack/work",
      evidence: {
        channel: "slack",
        accountId: SLACK_ACCOUNT,
        routePosition: 1,
        routeFingerprint: "route-fingerprint",
        conversationId: SLACK_CONVERSATION,
        threadId: SLACK_THREAD,
        providerSenderId: "slack:U0EXTERNAL",
        outcome: "ignored",
        outcomeDetail: "Route rate limit exceeded",
        limitDecision: "denied",
        limitReason: "Route rate limit exceeded",
      },
    });
  });
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

describe("channel_ingress_queue", () => {
  it("admits idempotently, claims with a lease, and completes with a token", async () => {
    const input = {
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: SLACK_ACCOUNT,
      externalEventId: "queue-event-1",
      externalMessageId: "queue-message-1",
      externalConversationId: SLACK_CONVERSATION,
      externalThreadId: SLACK_THREAD,
      laneKey: "slack/work/C0APP/1720000000.000000",
      payload: { text: "durable hello", sender: "U0ALICE" },
    } as const;
    const first = await store.enqueueChannelIngress(input);
    assert.equal(first.created, true);
    const replay = await store.enqueueChannelIngress(input);
    assert.equal(replay.created, false);
    assert.equal(replay.record.id, first.record.id);

    const claimed = await store.claimChannelIngress({
      organizationId: ORGANIZATION_ID,
      workerId: "worker-a",
      leaseMs: 30_000,
    });
    assert.ok(claimed);
    assert.equal(claimed.attempts, 1);
    assert.equal(claimed.status, "claimed");
    assert.equal(
      await store.refreshChannelIngress({
        id: claimed.id,
        workerId: "worker-a",
        claimToken: claimed.claimToken!,
        leaseMs: 60_000,
      }),
      true,
    );
    // Nothing else is claimable: this is the only queued event, and it is
    // already leased. (The lane rule itself is covered below, where a lane
    // actually has more than one row.)
    const nothingLeft = await store.claimChannelIngress({
      organizationId: ORGANIZATION_ID,
      workerId: "worker-b",
      leaseMs: 30_000,
    });
    assert.equal(nothingLeft, undefined);
    const completed = await store.completeChannelIngress({
      id: claimed.id,
      workerId: "worker-a",
      claimToken: claimed.claimToken!,
    });
    assert.equal(completed.status, "completed");
  });

  it("writes the caller's retry/dead-letter disposition", async () => {
    const enqueued = await store.enqueueChannelIngress({
      organizationId: ORGANIZATION_ID,
      channel: "telegram",
      accountId: TELEGRAM_ACCOUNT,
      externalEventId: "queue-event-retry",
      externalMessageId: "queue-message-retry",
      externalConversationId: TELEGRAM_CONVERSATION,
      laneKey: "telegram/personal/-1001234567890/42",
      payload: { text: "retry me" },
    });
    let row = await store.claimChannelIngress({
      organizationId: ORGANIZATION_ID,
      workerId: "worker-retry",
      leaseMs: 30_000,
    });
    assert.ok(row);
    row = await store.failChannelIngress({
      id: row.id,
      workerId: "worker-retry",
      claimToken: row.claimToken!,
      error: "temporary",
      disposition: "retry",
    });
    assert.equal(row.status, "failed");
    row = await store.claimChannelIngress({
      organizationId: ORGANIZATION_ID,
      workerId: "worker-retry",
      leaseMs: 30_000,
    });
    assert.ok(row);
    row = await store.failChannelIngress({
      id: row.id,
      workerId: "worker-retry",
      claimToken: row.claimToken!,
      error: "permanent",
      disposition: "dead_letter",
      reason: "retry-limit-exceeded",
    });
    assert.equal(row.status, "dead_letter");
    assert.equal(row.lastError, "permanent");
    assert.equal(row.failedReason, "retry-limit-exceeded");
    assert.ok(row.failedAt);
    assert.equal(enqueued.created, true);
  });

  it("resubmits dead-lettered events and prunes terminal rows", async () => {
    const stamp = new Date("2026-09-01T00:00:00.000Z");
    await store.enqueueChannelIngress({
      organizationId: ORGANIZATION_ID,
      channel: "telegram",
      accountId: TELEGRAM_ACCOUNT,
      externalEventId: "queue-event-operator",
      externalMessageId: "queue-message-operator",
      externalConversationId: TELEGRAM_CONVERSATION,
      laneKey: "telegram/personal/-1001234567890/operator",
      payload: { text: "operator recovery" },
      availableAt: stamp,
    });
    const claimed = await store.claimChannelIngress({
      organizationId: ORGANIZATION_ID,
      workerId: "worker-operator",
      leaseMs: 30_000,
      accountId: TELEGRAM_ACCOUNT,
      now: stamp,
    });
    assert.ok(claimed);
    const dead = await store.failChannelIngress({
      id: claimed.id,
      workerId: "worker-operator",
      claimToken: claimed.claimToken!,
      error: "invalid event",
      disposition: "dead_letter",
      reason: "invalid-event",
      now: stamp,
    });
    assert.equal(dead.status, "dead_letter");

    // A pending row must be left alone: resubmission is a dead-letter verb.
    const noop = await store.resubmitChannelIngress({
      organizationId: ORGANIZATION_ID,
      ids: ["00000000-0000-0000-0000-000000000000"],
    });
    assert.equal(noop.length, 0);

    const [resubmitted] = await store.resubmitChannelIngress({
      organizationId: ORGANIZATION_ID,
      ids: [dead.id],
    });
    assert.ok(resubmitted);
    assert.equal(resubmitted.status, "pending");
    assert.equal(resubmitted.attempts, 0);
    assert.equal(resubmitted.failedReason, null);
    assert.equal(resubmitted.failedAt, null);
    assert.equal(resubmitted.lastError, null);

    // Prune only touches terminal rows past their cutoff.
    const reclaimed = await store.claimChannelIngress({
      organizationId: ORGANIZATION_ID,
      workerId: "worker-operator",
      leaseMs: 30_000,
      accountId: TELEGRAM_ACCOUNT,
    });
    assert.ok(reclaimed);
    const completed = await store.completeChannelIngress({
      id: reclaimed.id,
      workerId: "worker-operator",
      claimToken: reclaimed.claimToken!,
      completedAt: stamp,
    });
    assert.equal(completed.status, "completed");
    assert.equal(
      await store.pruneChannelIngress({
        organizationId: ORGANIZATION_ID,
        completedOlderThan: stamp,
      }),
      0,
    );
    assert.equal(
      await store.pruneChannelIngress({
        organizationId: ORGANIZATION_ID,
        completedOlderThan: new Date(stamp.getTime() + 1),
      }),
      1,
    );
    const remaining = await store.listChannelIngress({
      organizationId: ORGANIZATION_ID,
      accountId: TELEGRAM_ACCOUNT,
      statuses: ["completed"],
    });
    assert.equal(
      remaining.some((row) => row.externalEventId === "queue-event-operator"),
      false,
    );
  });

  // Resubmission restarts the retry budget, not the row's place in its lane:
  // stamping `created_at` moved a recovered event behind everything that
  // arrived while it sat in the dead letter, so the conversation was answered
  // out of order.
  it("keeps a resubmitted row's place in its lane and restarts its age budget", async () => {
    const accountId = "resubmit-fifo";
    const base = new Date("2026-09-07T02:00:00.000Z");
    const first = await admitLaneEvent(accountId, "resubmit-1", base);
    const second = await admitLaneEvent(accountId, "resubmit-2", new Date(base.getTime() + 1_000));
    const claim = (at: Date) =>
      store.claimChannelIngress({
        organizationId: ORGANIZATION_ID,
        workerId: "worker-resubmit",
        leaseMs: 30_000,
        accountId,
        now: at,
      });
    const head = await claim(new Date(base.getTime() + 2_000));
    assert.equal(head?.id, first);
    await store.failChannelIngress({
      id: first,
      workerId: "worker-resubmit",
      claimToken: head!.claimToken!,
      error: "invalid event",
      disposition: "dead_letter",
      reason: "invalid-event",
      now: new Date(base.getTime() + 2_000),
    });
    // The lane moves on while the head is dead-lettered.
    const next = await claim(new Date(base.getTime() + 3_000));
    assert.equal(next?.id, second);
    await store.failChannelIngress({
      id: second,
      workerId: "worker-resubmit",
      claimToken: next!.claimToken!,
      error: "transient",
      disposition: "retry",
      retryAt: new Date(base.getTime() + 300_000),
      now: new Date(base.getTime() + 3_000),
    });

    const resubmitAt = new Date(base.getTime() + 10_000);
    const [reopened] = await store.resubmitChannelIngress({
      organizationId: ORGANIZATION_ID,
      ids: [first],
      now: resubmitAt,
    });
    assert.ok(reopened);
    assert.equal(reopened.createdAt.getTime(), base.getTime(), "arrival order is untouched");
    assert.equal(reopened.resubmittedAt?.getTime(), resubmitAt.getTime());
    // The retention sweep reads the resubmit, so the recovered row survives a
    // cutoff its original arrival would have failed — the row that was never
    // resubmitted does not.
    assert.equal(
      await store.pruneChannelIngress({
        organizationId: ORGANIZATION_ID,
        pendingOlderThan: new Date(base.getTime() + 5_000),
      }),
      1,
    );
    // It is the lane's head again, ahead of the row that arrived after it.
    const reclaimed = await claim(new Date(base.getTime() + 11_000));
    assert.equal(reclaimed?.id, first);
  });

  it("recovers an expired claim for restart drain", async () => {
    const now = new Date("2026-09-06T00:00:00.000Z");
    await store.enqueueChannelIngress({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: SLACK_ACCOUNT,
      externalEventId: "queue-event-stale",
      externalMessageId: "queue-message-stale",
      externalConversationId: "CSTALE",
      laneKey: "slack/work/CSTALE",
      payload: { text: "stale" },
      availableAt: now,
    });
    const claimed = await store.claimChannelIngress({
      organizationId: ORGANIZATION_ID,
      workerId: "worker-crash",
      leaseMs: 1,
      now,
    });
    assert.ok(claimed);
    const recovered = await store.recoverStaleChannelIngress({
      organizationId: ORGANIZATION_ID,
      now: new Date(now.getTime() + 2),
    });
    assert.equal(recovered, 1);
    const drained = await store.claimChannelIngress({
      organizationId: ORGANIZATION_ID,
      workerId: "worker-restart",
      leaseMs: 30_000,
      now: new Date(now.getTime() + 2),
    });
    assert.ok(drained);
    assert.equal(drained.id, claimed.id);
  });

  it("holds a lane in arrival order while its oldest row waits out a backoff", async () => {
    const accountId = "fifo";
    const base = new Date("2026-09-07T00:00:00.000Z");
    const first = await admitLaneEvent(accountId, "fifo-1", base);
    const second = await admitLaneEvent(accountId, "fifo-2", new Date(base.getTime() + 1_000));
    const claim = (at: Date) =>
      store.claimChannelIngress({
        organizationId: ORGANIZATION_ID,
        workerId: "worker-fifo",
        leaseMs: 30_000,
        accountId,
        now: at,
      });

    const head = await claim(new Date(base.getTime() + 2_000));
    assert.equal(head?.id, first);
    await store.failChannelIngress({
      id: first,
      workerId: "worker-fifo",
      claimToken: head!.claimToken!,
      error: "transient",
      disposition: "retry",
      retryAt: new Date(base.getTime() + 62_000),
      now: new Date(base.getTime() + 2_000),
    });

    // The younger row is due and unblocked by lease — but its lane's head is
    // sitting in a backoff window, so taking it would answer out of order.
    assert.equal(await claim(new Date(base.getTime() + 3_000)), undefined);

    const retried = await claim(new Date(base.getTime() + 63_000));
    assert.equal(retried?.id, first);
    assert.equal(retried?.attempts, 2);
    await store.completeChannelIngress({
      id: first,
      workerId: "worker-fifo",
      claimToken: retried!.claimToken!,
    });
    const next = await claim(new Date(base.getTime() + 64_000));
    assert.equal(next?.id, second);
    await store.completeChannelIngress({
      id: second,
      workerId: "worker-fifo",
      claimToken: next!.claimToken!,
    });
  });

  it("gives one lane to exactly one of two workers claiming at once", async () => {
    const accountId = "race";
    const base = new Date("2026-09-07T01:00:00.000Z");
    const first = await admitLaneEvent(accountId, "race-1", base);
    await admitLaneEvent(accountId, "race-2", new Date(base.getTime() + 1_000));
    const now = new Date(base.getTime() + 2_000);
    const claimAs = (workerId: string) =>
      store.claimChannelIngress({
        organizationId: ORGANIZATION_ID,
        workerId,
        leaseMs: 30_000,
        accountId,
        now,
      });

    const claims = (await Promise.all([claimAs("race-a"), claimAs("race-b")])).filter(
      (row) => row !== undefined,
    );

    // Two rows are due in one lane; a lane runs one at a time, so the loser
    // gets nothing rather than the second row. (The embedded runtime serializes
    // transactions, so this reads the committed claim rather than the
    // `skip locked` path a real Postgres would take — the invariant is the
    // same one the `not exists` candidate predicate holds either way.)
    assert.equal(claims.length, 1);
    assert.equal(claims[0]!.id, first);
  });

  it("releases a deferred claim unattempted and keeps its lane at the head", async () => {
    const accountId = "deferred";
    const base = new Date("2026-09-07T02:00:00.000Z");
    const first = await admitLaneEvent(accountId, "deferred-1", base);
    const second = await admitLaneEvent(accountId, "deferred-2", new Date(base.getTime() + 1_000));
    const claim = (at: Date) =>
      store.claimChannelIngress({
        organizationId: ORGANIZATION_ID,
        workerId: "worker-deferred",
        leaseMs: 30_000,
        accountId,
        now: at,
      });

    const head = await claim(new Date(base.getTime() + 2_000));
    assert.equal(head?.id, first);
    assert.equal(head?.attempts, 1);
    const released = await store.failChannelIngress({
      id: first,
      workerId: "worker-deferred",
      claimToken: head!.claimToken!,
      error: "Route concurrency limit exceeded",
      disposition: "release",
      retryAt: new Date(base.getTime() + 7_000),
      now: new Date(base.getTime() + 2_000),
    });
    // Back-pressure is not a failed attempt: the retry budget is untouched and
    // the row is pending again, not `failed`.
    assert.equal(released.status, "pending");
    assert.equal(released.attempts, 0);
    assert.equal(released.failedReason, null);
    assert.equal(released.availableAt.getTime(), base.getTime() + 7_000);

    assert.equal(await claim(new Date(base.getTime() + 3_000)), undefined);
    const redue = await claim(new Date(base.getTime() + 8_000));
    assert.equal(redue?.id, first);
    assert.equal(redue?.attempts, 1);
    await store.completeChannelIngress({
      id: first,
      workerId: "worker-deferred",
      claimToken: redue!.claimToken!,
    });
    const next = await claim(new Date(base.getTime() + 9_000));
    assert.equal(next?.id, second);
    await store.completeChannelIngress({
      id: second,
      workerId: "worker-deferred",
      claimToken: next!.claimToken!,
    });
  });

  /**
   * A release gives the attempt back, so the retry budget never ends a row the
   * plane keeps deferring. The release budget is the only thing that does.
   */
  it("dead-letters a release once the release budget or the pending TTL is spent", async () => {
    const budget = { maxReleases: 3, pendingTtlMs: 60 * 60 * 1_000 };
    const base = new Date("2026-09-07T04:00:00.000Z");
    const id = await admitLaneEvent("budget", "budget-1", base);
    const releaseOnce = async (at: Date) => {
      const claim = await store.claimChannelIngress({
        organizationId: ORGANIZATION_ID,
        workerId: "worker-budget",
        leaseMs: 30_000,
        accountId: "budget",
        now: at,
      });
      assert.equal(claim?.id, id);
      return await store.failChannelIngress({
        id,
        workerId: "worker-budget",
        claimToken: claim!.claimToken!,
        error: "Route concurrency limit exceeded",
        disposition: "release",
        retryAt: at,
        budget,
        now: at,
      });
    };

    const first = await releaseOnce(new Date(base.getTime() + 1_000));
    assert.equal(first.status, "pending");
    assert.equal(first.releases, 1);
    assert.equal(first.attempts, 0);
    const second = await releaseOnce(new Date(base.getTime() + 2_000));
    assert.equal(second.status, "pending");
    assert.equal(second.releases, 2);
    // The third release is the one that spends the budget.
    const spent = await releaseOnce(new Date(base.getTime() + 3_000));
    assert.equal(spent.status, "dead_letter");
    assert.equal(spent.releases, 3);
    assert.equal(spent.failedReason, "release-budget-exhausted");
    assert.equal(spent.failedAt?.getTime(), base.getTime() + 3_000);
    // Terminal: the drain cannot claim it again, and the lane is free.
    assert.equal(
      await store.claimChannelIngress({
        organizationId: ORGANIZATION_ID,
        workerId: "worker-budget",
        leaseMs: 30_000,
        accountId: "budget",
        now: new Date(base.getTime() + 4_000),
      }),
      undefined,
    );

    // Age alone ends a row that has barely been released at all.
    const agedBase = new Date("2026-09-07T05:00:00.000Z");
    const aged = await admitLaneEvent("budget-age", "budget-age-1", agedBase);
    const claim = await store.claimChannelIngress({
      organizationId: ORGANIZATION_ID,
      workerId: "worker-budget",
      leaseMs: 30_000,
      accountId: "budget-age",
      now: new Date(agedBase.getTime() + 1_000),
    });
    const expired = await store.failChannelIngress({
      id: aged,
      workerId: "worker-budget",
      claimToken: claim!.claimToken!,
      error: "Route concurrency limit exceeded",
      disposition: "release",
      budget,
      now: new Date(agedBase.getTime() + budget.pendingTtlMs + 1),
    });
    assert.equal(expired.status, "dead_letter");
    assert.equal(expired.releases, 1);
    assert.equal(expired.failedReason, "release-budget-exhausted");
  });

  /** The floor under a row no drain can reach: the retention sweep's cutoff. */
  it("prunes non-terminal rows admitted before the pending cutoff", async () => {
    const base = new Date("2026-09-07T06:00:00.000Z");
    const stale = await admitLaneEvent("unreachable", "unreachable-1", base);
    const fresh = await admitLaneEvent(
      "unreachable",
      "unreachable-2",
      new Date(base.getTime() + 60_000),
    );
    const pending = async () =>
      (
        await store.listChannelIngress({
          organizationId: ORGANIZATION_ID,
          accountId: "unreachable",
          statuses: ["pending"],
        })
      ).map((row) => row.id);

    // The cutoff is exclusive: a row admitted exactly at it stays.
    await store.pruneChannelIngress({ organizationId: ORGANIZATION_ID, pendingOlderThan: base });
    assert.deepEqual((await pending()).sort(), [stale, fresh].sort());
    await store.pruneChannelIngress({
      organizationId: ORGANIZATION_ID,
      pendingOlderThan: new Date(base.getTime() + 1),
    });
    assert.deepEqual(await pending(), [fresh]);
  });
});

/**
 * The `/agent` and `/model` choice. One row per conversation, and two commands
 * in the same conversation land on it at once.
 */
describe("channel_conversation_selections", () => {
  const CONVERSATION = "C0SELECT";
  const key = (channel: "slack" | "telegram") => ({
    organizationId: ORGANIZATION_ID,
    channel,
    accountId: "support",
    externalConversationId: CONVERSATION,
    externalThreadId: null,
  });

  // Both commands write the same row. Reading it first and writing the merge
  // back lost whichever field the slower writer had merged in.
  it("keeps a concurrent /agent and /model choice on one row", async () => {
    await Promise.all([
      store.access.setConversationSelection(key("slack"), {
        selectedAgent: "reviewer",
        selectedBy: "slack:U0ALICE",
      }),
      store.access.setConversationSelection(key("slack"), {
        selectedModel: "gpt-5.6-luna",
        selectedBy: "slack:U0BOB",
      }),
    ]);
    const stored = await store.access.findConversationSelection(key("slack"));
    assert.equal(stored?.selectedAgent, "reviewer");
    assert.equal(stored?.selectedModel, "gpt-5.6-luna");
  });

  // An account id is only unique inside its channel: `support` on Slack and
  // `support` on Telegram are two accounts, and the row was keyed without the
  // channel, so one channel's `/model` answered for the other's conversation.
  it("scopes a selection to its channel", async () => {
    await store.access.setConversationSelection(key("telegram"), {
      selectedModel: "gpt-5.6-mini",
      selectedBy: "telegram:1001",
    });
    assert.equal(
      (await store.access.findConversationSelection(key("telegram")))?.selectedModel,
      "gpt-5.6-mini",
    );
    assert.equal(
      (await store.access.findConversationSelection(key("slack")))?.selectedModel,
      "gpt-5.6-luna",
      "the slack conversation keeps its own choice",
    );
  });

  it("clears both fields when the caller sets two nulls", async () => {
    const cleared = await store.access.setConversationSelection(key("slack"), {
      selectedAgent: null,
      selectedModel: null,
      selectedBy: "slack:U0ALICE",
    });
    assert.equal(cleared.selectedAgent, null);
    assert.equal(cleared.selectedModel, null);
    assert.equal((await store.access.findConversationSelection(key("slack")))?.selectedModel, null);
  });
});

/**
 * The stored channel name is a closed set (`schema.ts` `channelNameCheck`,
 * derived from `SUPPORTED_CHANNEL_NAMES`): a channel the supervisor can start
 * must also be storable, and one it cannot start must not reach the tables.
 */
describe("supported channel names", () => {
  const DISCORD_ACCOUNT = "guild";
  const DISCORD_CONVERSATION = "1180000000000000001";
  const DISCORD_THREAD = "1180000000000000002";

  it("accepts a discord binding and delivery row", async () => {
    const pending = await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "discord",
      accountId: DISCORD_ACCOUNT,
      externalConversationId: DISCORD_CONVERSATION,
      externalThreadId: DISCORD_THREAD,
      pendingExecutionId: "discord-execution-1",
      initiator: "discord:U0DISCORD",
      route: ROUTE,
    });
    assert.equal(pending.channel, "discord");

    const delivery = await store.recordDelivery({
      organizationId: ORGANIZATION_ID,
      channel: "discord",
      accountId: DISCORD_ACCOUNT,
      externalConversationId: DISCORD_CONVERSATION,
      externalThreadId: DISCORD_THREAD,
      eventTurnId: "discord-turn-1",
      sequence: 0,
    });
    assert.equal(delivery.created, true);
    assert.equal(delivery.record.channel, "discord");
  });

  it("rejects a channel outside the supported set", async () => {
    // A channel outside `SUPPORTED_CHANNEL_NAMES` is one the supervisor cannot
    // start, so the check constraint keeps its rows out of the tables too.
    await assert.rejects(
      bundle.runtime.query(
        `insert into thread_bindings
           (organization_id, channel, account_id, external_conversation_id, status,
            pending_execution_id, initiator, route)
         values ($1, 'matrix', 'planned', 'C0PLANNED', 'pending', 'execution-planned', $2, '{}')`,
        [ORGANIZATION_ID, INITIATOR],
      ),
      /thread_bindings_channel_check/u,
    );
  });
});

/**
 * Admit one event onto a per-account lane with an explicit arrival time. The
 * lane rule reads `created_at`, which the table stamps itself, so the tests
 * that care about arrival order set it rather than racing the clock.
 */
async function admitLaneEvent(accountId: string, eventId: string, arrivedAt: Date) {
  const { record } = await store.enqueueChannelIngress({
    organizationId: ORGANIZATION_ID,
    channel: "slack",
    accountId,
    externalEventId: eventId,
    externalMessageId: eventId,
    externalConversationId: `C0${accountId.toUpperCase()}`,
    laneKey: `slack/${accountId}/lane`,
    payload: { event: eventId },
    availableAt: arrivedAt,
  });
  await bundle.runtime.query(`update channel_ingress_queue set created_at = $2 where id = $1`, [
    record.id,
    arrivedAt.toISOString(),
  ]);
  return record.id;
}
