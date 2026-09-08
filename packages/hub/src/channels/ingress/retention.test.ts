// Targeted tests for the ingress retention sweep on its production path: the
// real `ChannelStore` over a migrated embedded (PGlite) database. Rows reach
// their terminal state through the real enqueue → claim → settle calls; only
// the terminal timestamps are backdated, because the TTL is a fact about the
// clock and not about how the row got there.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { ChannelStore } from "../../db/channels.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../../db/runtime/index.js";
import type { ChannelIngressQueueStatus } from "../../db/schema.js";
import {
  CHANNEL_INGRESS_RETENTION_DEFAULTS,
  createChannelIngressRetentionSweep,
} from "./retention.js";

const CHANNEL = "telegram";
const ACCOUNT = "sweep";
const DAY_MS = 24 * 60 * 60 * 1_000;

let dataDirectory: string;
let bundle: DatabaseRuntimeBundle;
let store: ChannelStore;

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-ingress-retention-"));
  bundle = await embeddedDatabaseRuntime(dataDirectory);
  await bundle.runtime.migrate();
  for (const id of ["retention-a", "retention-b", "retention-c", "retention-d"]) {
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
async function seed(
  organizationId: string,
  eventId: string,
  status: ChannelIngressQueueStatus,
  ageDays = 0,
): Promise<string> {
  const admitted = await store.enqueueChannelIngress({
    organizationId,
    channel: CHANNEL,
    accountId: ACCOUNT,
    externalEventId: eventId,
    externalMessageId: eventId,
    externalConversationId: `conversation-${eventId}`,
    laneKey: `lane-${eventId}`,
    payload: { event: eventId },
  });
  const id = admitted.record.id;
  if (status === "pending") return id;
  const claim = await store.claimChannelIngress({
    organizationId,
    workerId: "sweep-worker",
    leaseMs: 60_000,
    channel: CHANNEL,
    accountId: ACCOUNT,
  });
  assert.ok(claim !== undefined && claim.claimToken !== null);
  assert.equal(claim.id, id);
  const settle = { id, workerId: "sweep-worker", claimToken: claim.claimToken };
  if (status === "completed") await store.completeChannelIngress(settle);
  else if (status === "failed") {
    // A retry inside its backoff window: still backlog, not claimable again,
    // so a later seed in this organization cannot steal it.
    await store.failChannelIngress({
      ...settle,
      error: "retry",
      disposition: "retry",
      retryAt: new Date(Date.now() + 60 * 60 * 1_000),
    });
  } else if (status === "dead_letter") {
    await store.failChannelIngress({
      ...settle,
      error: "gave up",
      disposition: "dead_letter",
      reason: "retry-limit-exceeded",
    });
  }
  if (ageDays > 0) {
    const at = new Date(Date.now() - ageDays * DAY_MS).toISOString();
    await bundle.runtime.query(
      `update channel_ingress_queue set completed_at = case when completed_at is null then null else $2::timestamptz end,
         failed_at = case when failed_at is null then null else $2::timestamptz end where id = $1`,
      [id, at],
    );
  }
  return id;
}

/** Backdate admission, which is what the unreachable-pending cutoff reads. */
async function admittedDaysAgo(id: string, days: number): Promise<void> {
  await bundle.runtime.query(`update channel_ingress_queue set created_at = $2 where id = $1`, [
    id,
    new Date(Date.now() - days * DAY_MS).toISOString(),
  ]);
}

async function statusOf(organizationId: string, id: string): Promise<string | undefined> {
  const rows = await store.listChannelIngress({ organizationId, limit: 100 });
  return rows.find((row) => row.id === id)?.status;
}

describe("channel ingress retention sweep", () => {
  it("deletes only terminal rows past their TTL and leaves the live backlog alone", async () => {
    const organizationId = "retention-a";
    // Claim-consuming states are seeded first: a claim takes the organization's
    // oldest available row, so a row parked in `pending` must be admitted last.
    const oldCompleted = await seed(organizationId, "old-completed", "completed", 31);
    const freshCompleted = await seed(organizationId, "fresh-completed", "completed", 1);
    const oldDead = await seed(organizationId, "old-dead", "dead_letter", 31);
    const freshDead = await seed(organizationId, "fresh-dead", "dead_letter", 1);
    const retrying = await seed(organizationId, "retrying", "failed");
    const claimed = await seed(organizationId, "claimed", "claimed");
    const pending = await seed(organizationId, "pending", "pending");

    const sweep = createChannelIngressRetentionSweep({ store });
    assert.equal(await sweep.sweepOnce(), 2);

    assert.equal(await statusOf(organizationId, oldCompleted), undefined);
    assert.equal(await statusOf(organizationId, oldDead), undefined);
    assert.equal(await statusOf(organizationId, freshCompleted), "completed");
    assert.equal(await statusOf(organizationId, freshDead), "dead_letter");
    assert.equal(await statusOf(organizationId, pending), "pending");
    assert.equal(await statusOf(organizationId, retrying), "failed");
    assert.equal(await statusOf(organizationId, claimed), "claimed");
    await sweep.stop();
  }, 60_000);

  it("sweeps every organization that owns queued rows", async () => {
    const first = await seed("retention-b", "b-old", "completed", 40);
    const second = await seed("retention-c", "c-old", "completed", 40);
    const keep = await seed("retention-c", "c-new", "completed", 2);

    assert.equal(await createChannelIngressRetentionSweep({ store }).sweepOnce(), 2);

    assert.equal(await statusOf("retention-b", first), undefined);
    assert.equal(await statusOf("retention-c", second), undefined);
    assert.equal(await statusOf("retention-c", keep), "completed");
  }, 60_000);

  /**
   * The release budget ends anything a drain can still claim, so a pending row
   * this old is one no drain reaches. The sweep is the only thing that clears
   * it, and it must not touch a backlog that is merely waiting.
   */
  it("deletes non-terminal rows no drain can reach any more", async () => {
    const organizationId = "retention-d";
    const claimed = await seed(organizationId, "d-claimed", "claimed");
    const retrying = await seed(organizationId, "d-retrying", "failed");
    const pending = await seed(organizationId, "d-pending", "pending");
    const fresh = await seed(organizationId, "d-fresh", "pending");
    for (const id of [claimed, retrying, pending]) await admittedDaysAgo(id, 31);

    assert.equal(await createChannelIngressRetentionSweep({ store }).sweepOnce(), 2);
    assert.equal(await statusOf(organizationId, pending), undefined);
    assert.equal(await statusOf(organizationId, retrying), undefined);
    assert.equal(await statusOf(organizationId, fresh), "pending");
    // A claim is somebody's work in flight; lease recovery owns it, not the
    // sweep, so an old claimed row survives the pass.
    assert.equal(await statusOf(organizationId, claimed), "claimed");
  }, 60_000);

  it("arms one timer on the upstream interval and releases it on stop", async () => {
    const scheduled: number[] = [];
    let cancelled = 0;
    let tick: (() => void) | undefined;
    const sweep = createChannelIngressRetentionSweep({
      store,
      schedule: (callback, intervalMs) => {
        scheduled.push(intervalMs);
        tick = callback;
        return () => {
          cancelled += 1;
        };
      },
    });
    sweep.start();
    sweep.start();
    assert.deepEqual(scheduled, [CHANNEL_INGRESS_RETENTION_DEFAULTS.pruneIntervalMs]);
    tick?.();
    await sweep.stop();
    await sweep.stop();
    assert.equal(cancelled, 1);
    // A tick after stop must not restart the loop or leave a sweep in flight.
    tick?.();
    assert.equal(scheduled.length, 1);
  }, 60_000);
});
