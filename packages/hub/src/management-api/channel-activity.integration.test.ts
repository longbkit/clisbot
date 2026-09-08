import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ChannelStore } from "../db/channels.js";
import { embeddedDatabaseRuntime } from "../db/runtime/index.js";
import { organizations } from "../db/schema.js";
import {
  channelActivityPage,
  channelActivityView,
  parseChannelActivityQuery,
} from "./channel-activity.js";

it("reads recorded inbound decisions only for the requested organization and Channel account", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-channel-activity-"));
  const { runtime } = await embeddedDatabaseRuntime(root);
  try {
    await runtime.migrate();
    await runtime
      .drizzle()
      .insert(organizations)
      .values([
        { id: "org-a", name: "A", slug: "org-a" },
        { id: "org-b", name: "B", slug: "org-b" },
      ]);
    const store = new ChannelStore(runtime);
    const event = {
      organizationId: "org-a",
      channel: "slack" as const,
      accountId: "support",
      routePosition: 0,
      routeFingerprint: "revision-route",
      externalConversationId: "C123",
      externalThreadId: "thread",
      senderIdentity: "U123",
      outcome: "ignored" as const,
      outcomeDetail: "sender is not allowed",
      limitDecision: "not_evaluated" as const,
    };
    await store.recordChannelInboundActivity(event);
    await store.recordChannelInboundActivity({ ...event, organizationId: "org-b" });
    await store.recordChannelInboundActivity({ ...event, accountId: "other" });
    const result = await channelActivityView(runtime, "org-a", "slack", "support");
    expect(result.activity).toEqual([
      {
        id: expect.any(String),
        createdAt: expect.any(String),
        channel: "slack",
        accountId: "support",
        routePosition: 0,
        conversationId: "C123",
        threadId: "thread",
        providerSenderId: "U123",
        outcome: "ignored",
        outcomeDetail: "sender is not allowed",
        limitDecision: "not_evaluated",
      },
    ]);
    expect(await channelActivityView(runtime, "org-a", "telegram", "support")).toEqual({
      activity: [],
      nextCursor: null,
    });
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

it("seeks bounded pages across timestamp ties, concurrent inserts and historical accounts", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-channel-activity-pages-"));
  const { runtime } = await embeddedDatabaseRuntime(root);
  try {
    await runtime.migrate();
    await runtime
      .drizzle()
      .insert(organizations)
      .values([
        { id: "org-a", name: "A", slug: "org-a" },
        { id: "org-b", name: "B", slug: "org-b" },
      ]);
    await runtime.query(`INSERT INTO audit_events
      (id, organization_id, actor_kind, actor_identity, action, subject_type, subject_id, evidence, created_at)
      SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
        'org-a', 'system', 'channel', 'channel.inbound.processed', 'channel_account',
        CASE WHEN n % 4 = 0 THEN 'telegram/removed/account' ELSE 'slack/support' END,
        jsonb_build_object('routePosition', n % 3, 'conversationId', 'C' || n,
          'threadId', NULL, 'providerSenderId', 'U' || n,
          'outcome', CASE WHEN n % 100 = 0 THEN 'error' ELSE 'ignored' END,
          'limitDecision', 'not_evaluated', 'privatePayload', 'must never be returned'),
        '2026-09-05T01:02:03.123456Z'::timestamptz - (n / 50) * interval '1 microsecond'
      FROM generate_series(1, 1250) n`);
    await runtime.query(`INSERT INTO audit_events
      (organization_id, actor_kind, actor_identity, action, subject_type, subject_id, evidence, created_at)
      SELECT 'org-b', actor_kind, actor_identity, action, subject_type, subject_id, evidence, created_at
      FROM audit_events LIMIT 1`);
    const first = await channelActivityPage(runtime, "org-a", { limit: 25 });
    expect(first.activity).toHaveLength(25);
    expect(first.nextCursor).toEqual(expect.any(String));
    await runtime.query(`INSERT INTO audit_events
      (organization_id, actor_kind, actor_identity, action, subject_type, subject_id, evidence, created_at)
      SELECT organization_id, actor_kind, actor_identity, action, subject_type, subject_id, evidence, now()
      FROM audit_events WHERE organization_id = 'org-a' LIMIT 1`);
    const ids = first.activity.map((entry) => entry.id);
    let cursor = first.nextCursor;
    while (cursor !== null) {
      const page = await channelActivityPage(runtime, "org-a", { limit: 25, cursor });
      expect(page.activity.length).toBeLessThanOrEqual(25);
      expect(JSON.stringify(page)).not.toContain("privatePayload");
      ids.push(...page.activity.map((entry) => entry.id));
      cursor = page.nextCursor;
    }
    expect(ids).toHaveLength(1250);
    expect(new Set(ids).size).toBe(1250);
    const filtered = await channelActivityPage(runtime, "org-a", {
      limit: 25,
      channel: "telegram",
      accountId: "removed/account",
      routePosition: 1,
      outcome: "error",
    });
    expect(filtered.activity).toHaveLength(4);
    expect(
      filtered.activity.every(
        (entry) =>
          entry.channel === "telegram" &&
          entry.accountId === "removed/account" &&
          entry.routePosition === 1 &&
          entry.outcome === "error",
      ),
    ).toBe(true);
    const orgB = await channelActivityPage(runtime, "org-b", { limit: 25 });
    expect(orgB.activity).toHaveLength(1);
    await expect(
      channelActivityPage(runtime, "org-b", { limit: 25, cursor: first.nextCursor! }),
    ).rejects.toThrow("invalid_channel_activity_cursor");
    await expect(
      channelActivityPage(runtime, "org-a", {
        limit: 25,
        outcome: "error",
        cursor: first.nextCursor!,
      }),
    ).rejects.toThrow("invalid_channel_activity_cursor");
    await expect(
      channelActivityPage(runtime, "org-a", { limit: 25, cursor: "bad-json" }),
    ).rejects.toThrow("invalid_channel_activity_cursor");
    await runtime.query(`INSERT INTO audit_events
      (organization_id, actor_kind, actor_identity, action, subject_type, subject_id, evidence, created_at)
      VALUES ('org-a', 'system', 'channel', 'channel.inbound.processed', 'channel_account',
        'slack/support', '{"malformed":true}', now() + interval '1 second')`);
    const malformedPage = await channelActivityPage(runtime, "org-a", { limit: 1 });
    expect(malformedPage.activity).toEqual([]);
    expect(malformedPage.nextCursor).not.toBeNull();
    const nextValidPage = await channelActivityPage(runtime, "org-a", {
      limit: 1,
      cursor: malformedPage.nextCursor!,
    });
    expect(nextValidPage.activity).toHaveLength(1);
    await runtime.query("ANALYZE audit_events");
    for (const [filter, index] of [
      ["", "audit_events_channel_created_idx"],
      ["AND subject_id = 'telegram/removed/account'", "audit_events_channel_account_created_idx"],
      ["AND evidence->>'outcome' = 'error'", "audit_events_channel_outcome_created_idx"],
    ]) {
      const plan = await runtime.query(`EXPLAIN (FORMAT JSON) SELECT id FROM audit_events
        WHERE organization_id = 'org-a' AND action = 'channel.inbound.processed'
          AND subject_type = 'channel_account' ${filter}
        ORDER BY created_at DESC NULLS LAST, id DESC NULLS LAST LIMIT 26`);
      expect(JSON.stringify(plan.rows)).toContain(index);
    }
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

it("validates bounded query filters before touching history", () => {
  expect(parseChannelActivityQuery(new URLSearchParams())).toEqual({ limit: 25 });
  expect(
    parseChannelActivityQuery(
      new URLSearchParams("channel=slack&accountId=a&routePosition=fallback&limit=100"),
    ),
  ).toEqual({ channel: "slack", accountId: "a", routePosition: "fallback", limit: 100 });
  for (const query of [
    "limit=0",
    "limit=101",
    "limit=1.5",
    "accountId=a",
    "routePosition=0",
    "outcome=other",
    "channel=irc",
    "unknown=1",
  ]) {
    expect(() => parseChannelActivityQuery(new URLSearchParams(query))).toThrow(
      "invalid_channel_activity_query",
    );
  }
});
