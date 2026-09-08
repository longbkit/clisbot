// The `channel-ingress` management operations against a migrated embedded
// (PGlite) database and the real `ChannelStore`. Every case is organization
// scoped on purpose: the guard in `ManagementApi` picks the organization, and
// these functions must not widen it.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { ChannelStore } from "../db/channels.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../db/runtime/index.js";
import type { ChannelIngressQueueStatus } from "../db/schema.js";
import {
  channelIngressListPage,
  channelIngressPrune,
  channelIngressPruneBodySchema,
  channelIngressResubmit,
  channelIngressStatusView,
  MIN_COMPLETED_PRUNE_AGE_MS,
  parseChannelIngressListQuery,
} from "./channel-ingress.js";

const CHANNEL = "slack";
const MINUTE_MS = 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

let dataDirectory: string;
let bundle: DatabaseRuntimeBundle;
let store: ChannelStore;

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-channel-ingress-"));
  bundle = await embeddedDatabaseRuntime(dataDirectory);
  await bundle.runtime.migrate();
  for (const id of ["org-a", "org-b"]) {
    await bundle.runtime.query(`insert into organization (id, name, slug) values ($1, $1, $1)`, [
      id,
    ]);
  }
  store = new ChannelStore(bundle.runtime);
}, 60_000);

afterAll(async () => {
  await bundle.runtime.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

/** Admit one event and drive it to `status` through the real queue calls. */
async function seed(input: {
  organizationId: string;
  accountId: string;
  eventId: string;
  status: ChannelIngressQueueStatus;
  ageMs?: number;
}): Promise<string> {
  const { organizationId, accountId, eventId, status } = input;
  const admitted = await store.enqueueChannelIngress({
    organizationId,
    channel: CHANNEL,
    accountId,
    externalEventId: eventId,
    externalMessageId: `message-${eventId}`,
    externalConversationId: `C-${accountId}`,
    externalThreadId: null,
    laneKey: `lane-${eventId}`,
    payload: { secret: "message body that must never reach an operator surface" },
  });
  const id = admitted.record.id;
  if (status !== "pending") {
    const claim = await store.claimChannelIngress({
      organizationId,
      workerId: "operator-test",
      leaseMs: 60_000,
      channel: CHANNEL,
      accountId,
    });
    assert.ok(claim !== undefined && claim.claimToken !== null);
    assert.equal(claim.id, id);
    const settle = { id, workerId: "operator-test", claimToken: claim.claimToken };
    if (status === "completed") await store.completeChannelIngress(settle);
    else if (status === "failed") {
      await store.failChannelIngress({
        ...settle,
        error: "retrying",
        disposition: "retry",
        retryAt: new Date(Date.now() + 60 * MINUTE_MS),
      });
    } else if (status === "dead_letter") {
      await store.failChannelIngress({
        ...settle,
        error: "handoff rejected the event",
        disposition: "dead_letter",
        reason: "invalid-event",
      });
    }
  }
  if (input.ageMs !== undefined) {
    const at = new Date(Date.now() - input.ageMs).toISOString();
    await bundle.runtime.query(
      `update channel_ingress_queue
         set created_at = $2::timestamptz,
             completed_at = case when completed_at is null then null else $2::timestamptz end,
             failed_at = case when failed_at is null then null else $2::timestamptz end
       where id = $1`,
      [id, at],
    );
  }
  return id;
}

describe("channel ingress operator operations", () => {
  it("reports queue depth, blocked lanes and backlog age for one organization only", async () => {
    await seed({
      organizationId: "org-a",
      accountId: "depth",
      eventId: "a-dead",
      status: "dead_letter",
    });
    await seed({
      organizationId: "org-a",
      accountId: "depth",
      eventId: "a-retry",
      status: "failed",
    });
    await seed({
      organizationId: "org-a",
      accountId: "depth",
      eventId: "a-pending",
      status: "pending",
      ageMs: 5 * MINUTE_MS,
    });
    await seed({
      organizationId: "org-b",
      accountId: "depth",
      eventId: "b-pending",
      status: "pending",
    });

    const health = await channelIngressStatusView(bundle.runtime, "org-a");
    assert.equal(health.accounts.length, 1);
    const [account] = health.accounts;
    assert.ok(account);
    assert.equal(account.channel, CHANNEL);
    assert.equal(account.accountId, "depth");
    assert.equal(account.pending, 1);
    assert.equal(account.claimed, 0);
    assert.equal(account.retrying, 1);
    assert.equal(account.deadLettered, 1);
    // The retry sits inside its backoff window, so its lane cannot move.
    assert.equal(account.lanesBlocked, 1);
    assert.ok((account.oldestPendingAgeMs ?? 0) >= 5 * MINUTE_MS);
    assert.equal(health.totals.pending, 1);
    assert.equal(health.totals.deadLettered, 1);

    const other = await channelIngressStatusView(bundle.runtime, "org-b");
    assert.deepEqual(
      other.accounts.map(({ accountId, pending, deadLettered }) => ({
        accountId,
        pending,
        deadLettered,
      })),
      [{ accountId: "depth", pending: 1, deadLettered: 0 }],
    );
  }, 60_000);

  it("pages redacted rows, filters by status and account, and never returns a payload", async () => {
    for (const index of [1, 2, 3]) {
      await seed({
        organizationId: "org-a",
        accountId: "paged",
        eventId: `page-${index}`,
        status: "pending",
      });
    }
    const query = parseChannelIngressListQuery(
      new URLSearchParams({ channel: CHANNEL, accountId: "paged", status: "pending", limit: "2" }),
    );
    const first = await channelIngressListPage(bundle.runtime, "org-a", query);
    assert.equal(first.events.length, 2);
    assert.equal(first.nextOffset, 2);
    assert.equal(JSON.stringify(first).includes("must never reach an operator surface"), false);
    assert.deepEqual(
      first.events.map((event) => event.externalEventId),
      ["page-1", "page-2"],
    );
    const second = await channelIngressListPage(bundle.runtime, "org-a", {
      ...query,
      offset: first.nextOffset ?? 0,
    });
    assert.deepEqual(
      second.events.map((event) => event.externalEventId),
      ["page-3"],
    );
    assert.equal(second.nextOffset, null);
    // Another organization's account id resolves to an empty page, not a leak.
    const foreign = await channelIngressListPage(bundle.runtime, "org-b", query);
    assert.deepEqual(foreign.events, []);
  }, 60_000);

  it("rejects an ambiguous or oversized list query", () => {
    assert.throws(() => parseChannelIngressListQuery(new URLSearchParams({ accountId: "paged" })));
    assert.throws(() =>
      parseChannelIngressListQuery(new URLSearchParams({ channel: CHANNEL, limit: "5000" })),
    );
    assert.throws(() => parseChannelIngressListQuery(new URLSearchParams({ status: "unknown" })));
  });

  it("resubmits only this organization's dead-lettered rows", async () => {
    const mine = await seed({
      organizationId: "org-a",
      accountId: "recover",
      eventId: "a-recover",
      status: "dead_letter",
    });
    const live = await seed({
      organizationId: "org-a",
      accountId: "recover",
      eventId: "a-live",
      status: "pending",
    });
    const theirs = await seed({
      organizationId: "org-b",
      accountId: "recover",
      eventId: "b-recover",
      status: "dead_letter",
    });

    const stolen = await channelIngressResubmit(bundle.runtime, "org-a", [theirs]);
    assert.deepEqual(stolen.resubmitted, []);
    const rows = await store.listChannelIngress({ organizationId: "org-b", accountId: "recover" });
    assert.equal(rows.find((row) => row.id === theirs)?.status, "dead_letter");

    const recovered = await channelIngressResubmit(bundle.runtime, "org-a", [mine, live]);
    assert.equal(recovered.resubmitted.length, 1);
    assert.equal(recovered.resubmitted[0]?.id, mine);
    assert.equal(recovered.resubmitted[0]?.status, "pending");
    assert.equal(recovered.resubmitted[0]?.attempts, 0);
    assert.equal(recovered.resubmitted[0]?.failedReason, null);
  }, 60_000);

  it("prunes terminal rows past the requested cutoff, in this organization only", async () => {
    const stale = await seed({
      organizationId: "org-a",
      accountId: "prune",
      eventId: "a-stale",
      status: "completed",
      ageMs: 40 * DAY_MS,
    });
    const recent = await seed({
      organizationId: "org-a",
      accountId: "prune",
      eventId: "a-recent",
      status: "completed",
    });
    const foreign = await seed({
      organizationId: "org-b",
      accountId: "prune",
      eventId: "b-stale",
      status: "completed",
      ageMs: 40 * DAY_MS,
    });

    const { deleted } = await channelIngressPrune(bundle.runtime, "org-a", {});
    assert.equal(deleted, 1);
    const remaining = await store.listChannelIngress({
      organizationId: "org-a",
      accountId: "prune",
    });
    assert.deepEqual(
      remaining.map((row) => row.id),
      [recent],
    );
    assert.equal(
      remaining.some((row) => row.id === stale),
      false,
    );
    const untouched = await store.listChannelIngress({
      organizationId: "org-b",
      accountId: "prune",
    });
    assert.deepEqual(
      untouched.map((row) => row.id),
      [foreign],
    );
  }, 60_000);

  // A completed row is the replay guard for its provider event: pruning one
  // lets the provider's own retry be admitted again as a new inbound, so the
  // operator cannot ask for "everything, now".
  it("refuses a completed-row cutoff under an hour", () => {
    assert.equal(
      channelIngressPruneBodySchema.safeParse({ completedOlderThanMs: 0 }).success,
      false,
    );
    assert.equal(
      channelIngressPruneBodySchema.safeParse({
        completedOlderThanMs: MIN_COMPLETED_PRUNE_AGE_MS - 1,
      }).success,
      false,
    );
    assert.equal(
      channelIngressPruneBodySchema.safeParse({
        completedOlderThanMs: MIN_COMPLETED_PRUNE_AGE_MS,
      }).success,
      true,
    );
    // The dead letter is an operator's own backlog: clearing it now is allowed.
    assert.equal(
      channelIngressPruneBodySchema.safeParse({ deadLetteredOlderThanMs: 0 }).success,
      true,
    );
  });
});
