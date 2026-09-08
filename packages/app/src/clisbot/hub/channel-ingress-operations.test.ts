import { describe, expect, it } from "vitest";
import { channelIngressEventsResource, isChannelOperationUnavailable } from "./channel-api";
import { HubApiError } from "./api-client";
import {
  CHANNEL_INGRESS_STALE_MS,
  channelDeadLetterRow,
  channelIngressAccountRows,
  channelIngressDepth,
  channelIngressPruneConfirmation,
  channelIngressResubmitConfirmation,
  channelIngressSeverity,
  channelIngressStatusLabel,
  channelIngressSummary,
  formatChannelQueueAge,
  resubmittableIngressIds,
  toggleChannelIngressSelection,
} from "./channel-ingress-operations";
import { CHANNEL_CATALOG_FIXTURE as catalog } from "./channel-catalog.fixture";
import { HubChannelIngressEventSchema, HubChannelIngressStatusSchema } from "./contracts";

function counts(overrides: Partial<Record<string, number | null>> = {}) {
  return {
    pending: 0,
    claimed: 0,
    retrying: 0,
    deadLettered: 0,
    lanesBlocked: 0,
    oldestPendingAgeMs: null,
    ...overrides,
  } as never;
}

const deadLetter = HubChannelIngressEventSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  channel: "telegram",
  accountId: "support",
  status: "dead_letter",
  attempts: 5,
  laneKey: "telegram:support:-100:12",
  externalEventId: "evt-1",
  externalMessageId: "42",
  externalConversationId: "-100123",
  externalThreadId: "12",
  availableAt: "2026-09-07T10:00:00.000Z",
  createdAt: "2026-09-07T09:55:00.000Z",
  lastAttemptAt: "2026-09-07T09:59:00.000Z",
  lastError: "daemon offline",
  failedReason: "retry_exhausted",
  failedAt: "2026-09-07T10:00:00.000Z",
  completedAt: null,
});

describe("queue depth and severity", () => {
  it("counts waiting work and leaves dead letters out of it", () => {
    expect(
      channelIngressDepth(counts({ pending: 3, claimed: 1, retrying: 2, deadLettered: 9 })),
    ).toBe(6);
  });

  it("escalates a dead letter over a blocked lane over a stale backlog", () => {
    expect(channelIngressSeverity(counts({ deadLettered: 1, lanesBlocked: 4 }))).toBe("error");
    expect(channelIngressSeverity(counts({ lanesBlocked: 1 }))).toBe("warning");
    expect(channelIngressSeverity(counts({ oldestPendingAgeMs: CHANNEL_INGRESS_STALE_MS }))).toBe(
      "warning",
    );
    expect(channelIngressSeverity(counts({ pending: 4, oldestPendingAgeMs: 1_000 }))).toBe("ok");
  });

  it("summarizes only the buckets that have something in them", () => {
    expect(channelIngressSummary(counts())).toBe("Queue empty");
    expect(channelIngressSummary(counts({ pending: 2, deadLettered: 1 }))).toBe(
      "2 pending · 1 dead-lettered",
    );
  });

  it("formats a backlog age coarsely", () => {
    expect(formatChannelQueueAge(null)).toBeNull();
    expect(formatChannelQueueAge(59_000)).toBe("under a minute");
    expect(formatChannelQueueAge(9 * 60_000)).toBe("9m");
    expect(formatChannelQueueAge(3 * 3_600_000 + 4 * 60_000)).toBe("3h 4m");
    expect(formatChannelQueueAge(50 * 3_600_000)).toBe("2d 2h");
  });
});

describe("account rows", () => {
  const status = HubChannelIngressStatusSchema.parse({
    accounts: [
      {
        channel: "telegram",
        accountId: "quiet",
        pending: 0,
        claimed: 0,
        retrying: 0,
        deadLettered: 0,
        completed: 12,
        oldestPendingAgeMs: null,
        lanesBlocked: 0,
      },
      {
        channel: "slack",
        accountId: "acme",
        pending: 4,
        claimed: 1,
        retrying: 0,
        deadLettered: 2,
        completed: 3,
        oldestPendingAgeMs: 600_000,
        lanesBlocked: 0,
      },
    ],
    totals: {
      pending: 4,
      claimed: 1,
      retrying: 0,
      deadLettered: 2,
      completed: 15,
      oldestPendingAgeMs: 600_000,
      lanesBlocked: 0,
    },
  });

  it("puts the deepest queue first and labels the channel from the catalog", () => {
    const rows = channelIngressAccountRows(status.accounts, catalog);
    expect(rows.map((row) => row.key)).toEqual(["slack:acme", "telegram:quiet"]);
    expect(rows[0]).toMatchObject({
      channelLabel: "Slack",
      depth: 5,
      severity: "error",
      oldestPending: "10m",
      summary: "4 pending · 1 in flight · 2 dead-lettered",
    });
    expect(rows[1]).toMatchObject({ severity: "ok", oldestPending: null });
  });
});

describe("dead-letter rows", () => {
  it("renders routing facts and the Hub's failure text, nothing else", () => {
    const row = channelDeadLetterRow(deadLetter, catalog);
    expect(row).toEqual({
      id: deadLetter.id,
      title: "Telegram · support",
      conversation: "-100123 · thread 12",
      attempts: "5 attempts",
      failedAt: "2026-09-07T10:00:00.000Z",
      reason: "retry_exhausted",
    });
  });

  it("falls back through lastError and then says so", () => {
    expect(
      channelDeadLetterRow({ ...deadLetter, failedReason: null, externalThreadId: null }, catalog),
    ).toMatchObject({ conversation: "-100123", reason: "daemon offline" });
    expect(
      channelDeadLetterRow(
        { ...deadLetter, failedReason: null, lastError: null, attempts: 1 },
        catalog,
      ),
    ).toMatchObject({ attempts: "1 attempt", reason: "No failure reason was recorded." });
  });

  it("labels a queue status the app does not know from its own id", () => {
    expect(channelIngressStatusLabel("dead_letter")).toBe("Dead-lettered");
    expect(channelIngressStatusLabel("quarantined")).toBe("quarantined");
  });
});

describe("selection and actions", () => {
  it("toggles a selection both ways", () => {
    const first = toggleChannelIngressSelection(new Set(), "a");
    expect([...first]).toEqual(["a"]);
    expect([...toggleChannelIngressSelection(first, "a")]).toEqual([]);
  });

  it("only ever resubmits dead-lettered rows", () => {
    const completed = { ...deadLetter, id: "other", status: "completed" };
    const selected = new Set([deadLetter.id, "other"]);
    expect(resubmittableIngressIds([deadLetter, completed], selected)).toEqual([deadLetter.id]);
  });

  it("confirms both destructive-ish operations in plain terms", () => {
    expect(channelIngressResubmitConfirmation(1).title).toBe("Resubmit 1 event?");
    expect(channelIngressResubmitConfirmation(3).title).toBe("Resubmit 3 events?");
    expect(channelIngressPruneConfirmation().confirmLabel).toBe("Prune");
  });
});

describe("ingress resource paths", () => {
  it("drops an account id that has no channel, which the Hub rejects", () => {
    expect(channelIngressEventsResource({ accountId: "support" })).toBe("channel-ingress/events");
    expect(channelIngressEventsResource({ channel: "telegram", accountId: "support" })).toBe(
      "channel-ingress/events?channel=telegram&accountId=support",
    );
  });

  it("omits a zero offset and an absent filter", () => {
    expect(channelIngressEventsResource({ limit: 25, offset: 0 })).toBe(
      "channel-ingress/events?limit=25",
    );
    expect(channelIngressEventsResource({ status: "dead_letter", offset: 25 })).toBe(
      "channel-ingress/events?status=dead_letter&offset=25",
    );
  });

  it("reads a 404 as an endpoint this Hub does not serve", () => {
    expect(isChannelOperationUnavailable(new HubApiError(404, "not_found", "no"))).toBe(true);
    expect(isChannelOperationUnavailable(new HubApiError(403, "access_denied", "no"))).toBe(false);
    expect(isChannelOperationUnavailable(new Error("offline"))).toBe(false);
  });
});
