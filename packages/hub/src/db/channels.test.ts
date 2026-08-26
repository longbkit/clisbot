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

describe("channel_accounts", () => {
  it("inserts, round-trips, and re-uses one account record", async () => {
    const account = await store.upsertChannelAccount({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: SLACK_ACCOUNT,
      status: "active",
      pinVersion: "2026.7.1-2",
      distIntegrity: "sha512-slack-pin",
      gitHead: "2d2ddc43",
      installDir: join(dataDirectory, "channels", SLACK_ACCOUNT),
      installedAt: new Date("2026-08-25T00:00:00Z"),
      secretRef: "~/.config/clisbot/secrets/slack-work.json",
      providerApplicationId: "slack-app-1",
      externalIdentity: { teamId: "T0APP", botUserId: "U0BOT" },
      transport: { mode: "socket" },
    });

    assert.equal(account.channel, "slack");
    assert.equal(account.accountId, SLACK_ACCOUNT);
    assert.equal(account.status, "active");
    assert.deepEqual(account.transport, { mode: "socket" });

    const reinserted = await store.upsertChannelAccount({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: SLACK_ACCOUNT,
      status: "suspended",
      transport: { mode: "webhook", webhookPath: "/channels/slack/work/webhook" },
    });
    assert.equal(reinserted.id, account.id, "upsert updates instead of duplicating");
    assert.equal(reinserted.status, "suspended");

    const found = await store.findChannelAccount(ORGANIZATION_ID, "slack", SLACK_ACCOUNT);
    assert.ok(found !== undefined);
    assert.equal(found?.id, account.id);
    assert.equal(found?.providerApplicationId, "slack-app-1");
    assert.deepEqual(found?.transport, {
      mode: "webhook",
      webhookPath: "/channels/slack/work/webhook",
    });

    await store.upsertChannelAccount({
      organizationId: ORGANIZATION_ID,
      channel: "telegram",
      accountId: TELEGRAM_ACCOUNT,
      status: "active",
      transport: { mode: "polling" },
    });
    const accounts = await store.listChannelAccounts(ORGANIZATION_ID);
    assert.deepEqual(
      accounts.map(({ channel, accountId }) => `${channel}:${accountId}`),
      ["slack:work", "telegram:personal"],
    );
  });

  it("admits two accounts of the same channel (multi-account, plan P4)", async () => {
    // A second Slack app under a different account id must not be blocked by a
    // global-unique provider index: uniqueness is scoped to (org, channel, account id).
    const work = await store.upsertChannelAccount({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: "work",
      status: "active",
      providerApplicationId: "app-a",
      transport: { mode: "socket" },
    });
    const ops = await store.upsertChannelAccount({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: "ops",
      status: "active",
      providerApplicationId: "app-b",
      transport: { mode: "webhook" },
    });
    assert.notEqual(work.id, ops.id);
    assert.equal(
      (await store.findChannelAccount(ORGANIZATION_ID, "slack", "ops"))?.providerApplicationId,
      "app-b",
    );
  });

  it("enforces one account per (organization, channel, account id)", async () => {
    // The upsert above collapsed the re-insert to the same row; a raw second row for the
    // same key must hit the unique index and be rejected at the database level.
    await assert.rejects(
      bundle.runtime.query(
        `insert into channel_accounts
           (id, organization_id, channel, account_id, status, transport)
         values (gen_random_uuid(), $1, 'slack', 'work', 'active', '{}')`,
        [ORGANIZATION_ID],
      ),
      /unique|duplicate/,
    );
  });
});

describe("thread_bindings", () => {
  it("records a pending marker, resolves it, and round-trips the binding", async () => {
    const pending = await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: SLACK_ACCOUNT,
      conversationId: SLACK_CONVERSATION,
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
      conversationId: SLACK_CONVERSATION,
      externalThreadId: SLACK_THREAD,
      pendingExecutionId: "execution-1",
      initiator: INITIATOR,
      route: ROUTE,
    });
    assert.equal(replayed.id, pending.id, "a replayed create reuses the stored marker");

    const bound = await store.resolvePendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      accountId: SLACK_ACCOUNT,
      conversationId: SLACK_CONVERSATION,
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
        conversationId: SLACK_CONVERSATION,
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
        conversationId: SLACK_CONVERSATION,
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
      conversationId: SLACK_CONVERSATION,
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
  });

  it("lists pending markers for orphan recovery", async () => {
    const telegramPending = await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "telegram",
      accountId: TELEGRAM_ACCOUNT,
      conversationId: TELEGRAM_CONVERSATION,
      externalThreadId: TELEGRAM_TOPIC,
      pendingExecutionId: "execution-9",
      initiator: "telegram:123456789",
      route: ROUTE,
    });
    const abandoned = await store.abandonPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      accountId: TELEGRAM_ACCOUNT,
      conversationId: TELEGRAM_CONVERSATION,
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
    conversationId: SLACK_CONVERSATION,
    externalThreadId: SLACK_THREAD,
  };

  it("records before posting and dedupes replays on the same key", async () => {
    const first = await store.recordDelivery({ ...key, eventTurnId: "turn-1", sequence: 0 });
    assert.equal(first.created, true);
    assert.equal(first.record.status, "recorded");
    assert.equal(first.record.nativeMessageId, null);

    const replay = await store.recordDelivery({ ...key, eventTurnId: "turn-1", sequence: 0 });
    assert.equal(replay.created, false, "a replayed stream event must not re-record");
    assert.equal(replay.record.id, first.record.id);

    const next = await store.recordDelivery({ ...key, eventTurnId: "turn-1", sequence: 1 });
    assert.equal(next.created, true, "a new sequence in the same turn is a new attempt");
  });

  it("confirms a delivery and idempotently re-confirms it", async () => {
    const recorded = await store.recordDelivery({ ...key, eventTurnId: "turn-1", sequence: 0 });
    const posted = await store.confirmDelivery({
      organizationId: ORGANIZATION_ID,
      accountId: SLACK_ACCOUNT,
      conversationId: SLACK_CONVERSATION,
      externalThreadId: SLACK_THREAD,
      eventTurnId: "turn-1",
      sequence: 0,
      nativeMessageId: "1720000000.000001",
      postedAt: new Date("2026-08-25T03:00:00Z"),
    });
    assert.equal(posted.status, "posted");
    assert.equal(posted.nativeMessageId, "1720000000.000001");

    const again = await store.confirmDelivery({
      organizationId: ORGANIZATION_ID,
      accountId: SLACK_ACCOUNT,
      conversationId: SLACK_CONVERSATION,
      externalThreadId: SLACK_THREAD,
      eventTurnId: "turn-1",
      sequence: 0,
      nativeMessageId: "1720000000.000002",
      postedAt: new Date("2026-08-25T03:00:01Z"),
    });
    assert.equal(again.id, posted.id, "re-confirm returns the stored row");
    assert.equal(again.nativeMessageId, "1720000000.000001");

    const found = await store.findDeliveryLedgerRecord(
      ORGANIZATION_ID,
      SLACK_ACCOUNT,
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
      conversationId: SLACK_CONVERSATION,
      externalThreadId: SLACK_THREAD,
      eventTurnId: "turn-2",
      sequence: 0,
      failureReason: "rate limited",
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.failureReason, "rate limited");
    assert.equal(failed.nativeMessageId, null, "a failed post has no native id yet");

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

    // A later retry confirms the same record — the ledger does not need a new row.
    const posted = await store.confirmDelivery({
      organizationId: ORGANIZATION_ID,
      accountId: SLACK_ACCOUNT,
      conversationId: SLACK_CONVERSATION,
      externalThreadId: SLACK_THREAD,
      eventTurnId: "turn-2",
      sequence: 0,
      nativeMessageId: "1720000000.000003",
      postedAt: new Date("2026-08-25T03:00:02Z"),
    });
    assert.equal(posted.id, failed.id, "the retry reuses the failed record");
    assert.equal(posted.status, "posted");
    assert.equal(posted.nativeMessageId, "1720000000.000003");
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
      SLACK_CONVERSATION,
      SLACK_THREAD,
      "turn-3",
      0,
    );
    assert.equal(found?.status, "recorded");
    assert.equal(found?.nativeMessageId, null);

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
        conversationId: SLACK_CONVERSATION,
        externalThreadId: SLACK_THREAD,
        eventTurnId: "turn-none",
        sequence: 0,
        failureReason: "rate limited",
      }),
      ChannelDeliveryRecordNotFoundError,
    );
  });
});
