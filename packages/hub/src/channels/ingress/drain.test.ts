// Targeted tests for the durable ingress drain on its production path: the
// real `ChannelStore` over a migrated embedded (PGlite) database, the real
// queue-sink adapter, and the retry policy ported verbatim from OpenClaw
// (`@getpaseo/channels-core/channels/message/ingress-retry-policy`). Nothing
// here fakes the queue — a fake would prove the loop and not the claim lease,
// the lane lock or the fencing token, which are the parts a restart depends on.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { InboundQueueSink } from "@getpaseo/channels-shared";
import { ChannelStore } from "../../db/channels.js";
import type { ChannelIngressQueueRecord } from "../../db/types.js";
import { embeddedDatabaseRuntime } from "../../db/runtime/index.js";
import type { DatabaseRuntimeBundle } from "../../db/runtime/index.js";
import {
  createChannelIngressDrain,
  type ChannelIngressDrain,
  type ChannelIngressDrainOptions,
} from "./drain.js";
import { resolveHubIngressNonRetryableFailure } from "./non-retryable.js";
import {
  createChannelIngressQueueSink,
  type ChannelIngressQueueSinkOptions,
} from "./queue-sink.js";

const ORGANIZATION_ID = "drain-org";
const CHANNEL = "telegram";

let dataDirectory: string;
let bundle: DatabaseRuntimeBundle;
let store: ChannelStore;

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-ingress-drain-"));
  bundle = await embeddedDatabaseRuntime(dataDirectory);
  await bundle.runtime.migrate();
  await bundle.runtime.query(
    `insert into organization (id, name, slug) values ($1, 'Drain Org', 'drain-org')`,
    [ORGANIZATION_ID],
  );
  store = new ChannelStore(bundle.runtime);
}, 60_000);

afterAll(async () => {
  await bundle.runtime.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

function sinkFor(
  accountId: string,
  options: Partial<ChannelIngressQueueSinkOptions> = {},
): InboundQueueSink {
  return createChannelIngressQueueSink({
    store,
    organizationId: ORGANIZATION_ID,
    channel: CHANNEL,
    accountId,
    ...options,
  });
}

async function admit(
  accountId: string,
  eventId: string,
  laneKey = `lane-${accountId}`,
): Promise<void> {
  await sinkFor(accountId).enqueue({
    channel: CHANNEL,
    accountId,
    externalEventId: eventId,
    externalMessageId: eventId,
    externalConversationId: `conversation-${accountId}`,
    laneKey,
    payload: { event: eventId },
  });
}

async function readEvent(accountId: string, eventId: string): Promise<ChannelIngressQueueRecord> {
  const rows = await store.listChannelIngress({ organizationId: ORGANIZATION_ID, accountId });
  const row = rows.find((entry) => entry.externalEventId === eventId);
  assert.ok(row, `no ingress row for ${eventId}`);
  return row;
}

function drainFor(
  accountId: string,
  overrides: Partial<ChannelIngressDrainOptions> & {
    dispatch: ChannelIngressDrainOptions["dispatch"];
  },
) {
  return createChannelIngressDrain({
    queue: sinkFor(accountId),
    organizationId: ORGANIZATION_ID,
    channel: CHANNEL,
    accountId,
    workerId: `${CHANNEL}:${accountId}:drain`,
    abortSignal: new AbortController().signal,
    resolveNonRetryableFailure: resolveHubIngressNonRetryableFailure,
    ...overrides,
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("channel ingress drain", () => {
  it("schedules the upstream backoff delay for a retryable failure", async () => {
    const accountId = "backoff";
    await admit(accountId, "event-backoff");
    // An hour out: a backoff that lands in the past would make the row due
    // again inside the same pass, and the assertion below would count the
    // batch instead of the one retry it is about.
    const now = Date.now() + 3_600_000;
    const retries: Array<{ retryAt: Date; message: string }> = [];
    const drain = drainFor(accountId, {
      dispatch: () => Promise.reject(new Error("daemon client is not connected")),
      now: () => now,
      log: { retried: (_claim, detail) => retries.push(detail) },
    });

    const pass = await drain.drainOnce();

    assert.deepEqual(pass, {
      claimed: 1,
      completed: 0,
      retried: 1,
      deadLettered: 0,
      deferred: 0,
      abandoned: 0,
    });
    // First attempt: base 1s, factor 2, no jitter (DEFAULT_INGRESS_RETRY_BASE_MS).
    assert.equal(retries[0]?.retryAt.getTime(), now + 1_000);
    assert.equal(retries[0]?.message, "daemon client is not connected");
    const row = await readEvent(accountId, "event-backoff");
    assert.equal(row.status, "failed");
    assert.equal(row.attempts, 1);
    assert.equal(row.availableAt.getTime(), now + 1_000);
    assert.equal(row.lastError, "daemon client is not connected");
    assert.equal(row.failedReason, null);
  });

  it("dead-letters once the attempt ceiling and the minimum age are both met", async () => {
    const accountId = "ceiling";
    await admit(accountId, "event-ceiling");
    const deadLetters: Array<{ reason: string; message: string }> = [];
    const drain = drainFor(accountId, {
      dispatch: () => Promise.reject(new Error("handoff refused")),
      // baseMs 0 makes each retry immediately due, so one pass walks the whole
      // budget; deadLetterMinAgeMs 0 removes upstream's 24h age floor.
      retryPolicy: { maxAttempts: 3, deadLetterMinAgeMs: 0, baseMs: 0, maxMs: 0 },
      log: { deadLettered: (_claim, detail) => deadLetters.push(detail) },
    });

    const pass = await drain.drainOnce();

    assert.equal(pass.claimed, 3);
    assert.equal(pass.retried, 2);
    assert.equal(pass.deadLettered, 1);
    assert.equal(deadLetters.length, 1);
    assert.equal(deadLetters[0]?.reason, "retry-limit-exceeded");
    assert.equal(deadLetters[0]?.message, "handoff refused");
    const row = await readEvent(accountId, "event-ceiling");
    assert.equal(row.status, "dead_letter");
    assert.equal(row.attempts, 3);
    assert.equal(row.failedReason, "retry-limit-exceeded");
    assert.ok(row.failedAt);
  });

  it("dead-letters a non-retryable failure without spending the retry budget", async () => {
    const accountId = "non-retryable";
    await admit(accountId, "event-non-retryable");
    const missingAgent = new Error('Unknown agent "worker-app"');
    missingAgent.name = "ChannelAgentSpecError";
    const drain = drainFor(accountId, { dispatch: () => Promise.reject(missingAgent) });

    const pass = await drain.drainOnce();

    assert.equal(pass.deadLettered, 1);
    assert.equal(pass.retried, 0);
    const row = await readEvent(accountId, "event-non-retryable");
    assert.equal(row.status, "dead_letter");
    assert.equal(row.attempts, 1);
    assert.equal(row.failedReason, "missing-agent-harness");
  });

  it("resubmitted dead-letters are drained again", async () => {
    const accountId = "resubmit";
    await admit(accountId, "event-resubmit");
    const failing = drainFor(accountId, {
      dispatch: () => Promise.reject(new Error("temporary")),
      retryPolicy: { maxAttempts: 1, deadLetterMinAgeMs: 0, baseMs: 0, maxMs: 0 },
    });
    await failing.drainOnce();
    const dead = await readEvent(accountId, "event-resubmit");
    assert.equal(dead.status, "dead_letter");

    await store.resubmitChannelIngress({ organizationId: ORGANIZATION_ID, ids: [dead.id] });
    const delivered: unknown[] = [];
    const healthy = drainFor(accountId, {
      dispatch: async (payload) => {
        delivered.push(payload);
      },
    });

    const pass = await healthy.drainOnce();

    assert.equal(pass.completed, 1);
    assert.deepEqual(delivered, [{ event: "event-resubmit" }]);
    assert.equal((await readEvent(accountId, "event-resubmit")).status, "completed");
  });

  it("refuses a second claim on a lane while the first lease is live", async () => {
    const accountId = "lane";
    await admit(accountId, "event-lane-1", "shared-lane");
    await admit(accountId, "event-lane-2", "shared-lane");
    const held = await store.claimChannelIngress({
      organizationId: ORGANIZATION_ID,
      workerId: "worker-holding-the-lane",
      leaseMs: 60_000,
      accountId,
    });
    assert.ok(held);
    const delivered: unknown[] = [];
    const drain = drainFor(accountId, {
      dispatch: async (payload) => {
        delivered.push(payload);
      },
    });

    const blocked = await drain.drainOnce();
    assert.deepEqual(blocked, {
      claimed: 0,
      completed: 0,
      retried: 0,
      deadLettered: 0,
      deferred: 0,
      abandoned: 0,
    });
    assert.deepEqual(delivered, []);

    await store.completeChannelIngress({
      id: held.id,
      workerId: "worker-holding-the-lane",
      claimToken: held.claimToken!,
    });
    const freed = await drain.drainOnce();
    assert.equal(freed.completed, 1);
    assert.equal(delivered.length, 1);
  });

  it("recovers a dead worker's claim and delivers the event exactly once", async () => {
    const accountId = "crash";
    await admit(accountId, "event-crash");
    // Process death: a claim taken with a lease that expires and is never
    // completed or failed. Nothing else marks the row.
    const orphan = await store.claimChannelIngress({
      organizationId: ORGANIZATION_ID,
      workerId: "worker-that-died",
      leaseMs: 1,
      accountId,
    });
    assert.ok(orphan);
    await sleep(20);

    const delivered: unknown[] = [];
    const successor = drainFor(accountId, {
      dispatch: async (payload) => {
        delivered.push(payload);
      },
    });
    const recovered = await successor.drainOnce();
    // A second pass proves the completed tombstone, not just the first claim.
    const replay = await successor.drainOnce();

    assert.equal(recovered.completed, 1);
    assert.equal(replay.claimed, 0);
    assert.deepEqual(delivered, [{ event: "event-crash" }]);
    const row = await readEvent(accountId, "event-crash");
    assert.equal(row.status, "completed");
    assert.equal(row.id, orphan.id);
  });

  it("stops cleanly: no timer keeps draining after stop()", async () => {
    const accountId = "lifecycle";
    const delivered: unknown[] = [];
    const drain = drainFor(accountId, {
      intervalMs: 5,
      dispatch: async (payload) => {
        delivered.push(payload);
      },
    });
    drain.start();
    await admit(accountId, "event-lifecycle-1");
    drain.requestDrain();
    for (let tick = 0; tick < 40 && delivered.length === 0; tick += 1) await sleep(10);
    assert.equal(delivered.length, 1);

    await drain.stop();
    await drain.stop();

    await admit(accountId, "event-lifecycle-2");
    drain.requestDrain();
    await sleep(50);
    assert.equal(delivered.length, 1);
    assert.equal((await readEvent(accountId, "event-lifecycle-2")).status, "pending");
  });

  it("runs another pass for a wake that lands while the pump is settling", async () => {
    // `requestDrain()` can land in the microtask window between the pump's last
    // read of its wake flag and the pump handle being cleared; a wake dropped
    // there waits for the interval timer, which in production is 15 seconds of
    // silence on a live conversation. Which microtask that is depends on how
    // many awaits the pass happened to take, so the wake is driven at every
    // depth around it: all of them must produce the second pass.
    for (let depth = 0; depth <= 8; depth += 1) {
      const accountId = `wake-${depth}`;
      await admit(accountId, `event-wake-${depth}-1`);
      await admit(accountId, `event-wake-${depth}-2`);
      const delivered: unknown[] = [];
      let woken = false;
      let drain: ChannelIngressDrain | undefined;
      drain = drainFor(accountId, {
        // Far past the test: only the wake can produce the second pass.
        intervalMs: 600_000,
        batchLimit: 1,
        dispatch: async (payload) => {
          delivered.push(payload);
        },
        log: {
          drained: () => {
            if (woken) return;
            woken = true;
            void microtasks(depth).then(() => drain?.requestDrain());
          },
        },
      });

      drain.start();
      for (let tick = 0; tick < 50 && delivered.length < 2; tick += 1) await sleep(2);
      await drain.stop();

      assert.equal(delivered.length, 2, `the wake at microtask depth ${depth} was dropped`);
    }
  });

  it("keeps draining the backlog when one claim loses its fencing race", async () => {
    const accountId = "conflict";
    await admit(accountId, "event-conflict-1", "lane-conflict-1");
    await admit(accountId, "event-conflict-2", "lane-conflict-2");
    // No `refresh`: the lease keeper would notice the theft first, and the case
    // under test is the settle write itself losing the fence.
    const { refresh: _unrefreshed, ...queue } = sinkFor(accountId);
    const delivered: string[] = [];
    const abandoned: string[] = [];
    const drain = createChannelIngressDrain({
      queue,
      organizationId: ORGANIZATION_ID,
      channel: CHANNEL,
      accountId,
      workerId: `${CHANNEL}:${accountId}:drain`,
      abortSignal: new AbortController().signal,
      leaseMs: 5,
      dispatch: async (payload) => {
        const event = (payload as { event: string }).event;
        delivered.push(event);
        if (event !== "event-conflict-1") return;
        // This claim's lease runs out mid-dispatch and another worker recovers
        // and re-claims the row, so the completion below is written by a worker
        // that no longer owns it.
        await sleep(20);
        assert.equal(
          await store.recoverStaleChannelIngress({ organizationId: ORGANIZATION_ID, accountId }),
          1,
        );
        assert.ok(
          await store.claimChannelIngress({
            organizationId: ORGANIZATION_ID,
            workerId: "worker-that-took-over",
            leaseMs: 60_000,
            accountId,
          }),
        );
      },
      log: { abandoned: (_claim, detail) => abandoned.push(detail.reason) },
    });

    const pass = await drain.drainOnce();

    assert.equal(pass.abandoned, 1);
    assert.equal(pass.completed, 1);
    assert.equal(abandoned.length, 1);
    // The lost claim did not end the pass: the next lane was still drained.
    assert.deepEqual(delivered, ["event-conflict-1", "event-conflict-2"]);
    assert.equal((await readEvent(accountId, "event-conflict-2")).status, "completed");
    const stolen = await readEvent(accountId, "event-conflict-1");
    assert.equal(stolen.status, "claimed");
    assert.equal(stolen.claimedBy, "worker-that-took-over");
  });

  it("aborts the dispatch and settles nothing when the lease is lost", async () => {
    const accountId = "lease-lost";
    await admit(accountId, "event-lease-lost");
    const abandoned: string[] = [];
    let sawAbort = false;
    const drain = drainFor(accountId, {
      // Refreshed every 20ms; the first refresh after the theft reports the row
      // is gone.
      leaseMs: 60,
      dispatch: async (_payload, _claim, signal) => {
        const afterTheLease = new Date(Date.now() + 60_000);
        await store.recoverStaleChannelIngress({
          organizationId: ORGANIZATION_ID,
          accountId,
          now: afterTheLease,
        });
        await store.claimChannelIngress({
          organizationId: ORGANIZATION_ID,
          workerId: "worker-that-took-over",
          leaseMs: 600_000,
          accountId,
          now: afterTheLease,
        });
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        sawAbort = signal.aborted;
      },
      log: { abandoned: (_claim, detail) => abandoned.push(detail.reason) },
    });

    const pass = await drain.drainOnce();

    assert.equal(sawAbort, true);
    assert.deepEqual(pass, {
      claimed: 1,
      completed: 0,
      retried: 0,
      deadLettered: 0,
      deferred: 0,
      abandoned: 1,
    });
    assert.deepEqual(abandoned, ["claim lease lost"]);
    // Neither completed nor failed: the row belongs to the worker that took it.
    const row = await readEvent(accountId, "event-lease-lost");
    assert.equal(row.status, "claimed");
    assert.equal(row.claimedBy, "worker-that-took-over");
  });

  it("releases a deferred event and completes a declined one", async () => {
    const accountId = "deferral";
    await admit(accountId, "event-deferred", "lane-deferred");
    await admit(accountId, "event-declined", "lane-declined");
    const deferrals: Array<{ reason: string; retryAt: Date }> = [];
    // An hour out, so the released row is not due again inside this pass.
    const now = Date.now() + 3_600_000;
    const drain = drainFor(accountId, {
      now: () => now,
      dispatch: async (payload) => {
        if ((payload as { event: string }).event !== "event-deferred") return;
        return {
          kind: "deferred",
          reason: "Route concurrency limit exceeded",
          retryAfterMs: 5_000,
        };
      },
      log: { deferred: (_claim, detail) => deferrals.push(detail) },
    });

    const pass = await drain.drainOnce();

    assert.equal(pass.deferred, 1);
    assert.equal(pass.completed, 1);
    assert.deepEqual(
      deferrals.map((detail) => detail.retryAt.getTime()),
      [now + 5_000],
    );
    // Back-pressure returns the message to the queue with its attempt intact;
    // a decision completes the row.
    const deferred = await readEvent(accountId, "event-deferred");
    assert.equal(deferred.status, "pending");
    assert.equal(deferred.attempts, 0);
    assert.equal(deferred.availableAt.getTime(), now + 5_000);
    assert.equal(deferred.lastError, "Route concurrency limit exceeded");
    assert.equal((await readEvent(accountId, "event-declined")).status, "completed");
  });

  /**
   * Back-pressure that never clears is a stuck row. A release gives the attempt
   * back, so the retry budget cannot end it; the sink's release budget does,
   * and the operator gets a dead letter to resubmit instead of a lane that
   * quietly never moves.
   */
  it("dead-letters an event the plane defers past its release budget", async () => {
    const accountId = "release-budget";
    await admit(accountId, "event-forever", "lane-forever");
    const exhausted: string[] = [];
    const queue = sinkFor(accountId, {
      releaseBudget: { maxReleases: 2, pendingTtlMs: 24 * 60 * 60 * 1_000 },
      onReleaseBudgetExhausted: (record) => exhausted.push(record.failedReason ?? ""),
    });
    const drain = createChannelIngressDrain({
      queue,
      organizationId: ORGANIZATION_ID,
      channel: CHANNEL,
      accountId,
      workerId: `${CHANNEL}:${accountId}:drain`,
      abortSignal: new AbortController().signal,
      resolveNonRetryableFailure: resolveHubIngressNonRetryableFailure,
      dispatch: async () => ({
        kind: "deferred" as const,
        reason: "Route concurrency limit exceeded",
        retryAfterMs: 0,
      }),
    });

    // `retryAfterMs: 0` makes the released row due again immediately, so one
    // pass keeps re-claiming it — exactly the loop the budget has to end.
    const pass = await drain.drainOnce();
    assert.equal(pass.deferred, 2);

    const settled = await readEvent(accountId, "event-forever");
    assert.equal(settled.status, "dead_letter");
    assert.equal(settled.releases, 2);
    assert.equal(settled.failedReason, "release-budget-exhausted");
    assert.deepEqual(exhausted, ["release-budget-exhausted"]);
    // Terminal: the next pass has nothing to claim.
    assert.equal((await drain.drainOnce()).claimed, 0);
    await drain.stop();
  });
});

/** Yield `count` microtask turns, so a wake can be aimed at one of them. */
async function microtasks(count: number): Promise<void> {
  for (let step = 0; step < count; step += 1) await Promise.resolve();
}
