import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresQueryRuntime } from "../db/test-utils/runtime.js";
import { createDatabase } from "../db/test-utils/runtime.js";
import type { Database } from "../db/types.js";
import { EntitlementDenied, UNLIMITED_TEMPLATE } from "./catalog.js";
import { EntitlementsService } from "./service.js";

describe("EntitlementsService.consume against PostgreSQL", () => {
  let postgres: StartedPostgreSqlContainer;
  let database: Database;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
    database = await createDatabase(postgres.getConnectionUri());
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await postgres.stop();
  }, 120_000);

  async function seedOrganization(): Promise<string> {
    const organizationId = `org-${randomUUID()}`;
    const client = await createPostgresQueryRuntime(postgres.getConnectionUri());

    try {
      await client.query(`insert into organization (id, name, slug) values ($1, $2, $3)`, [
        organizationId,
        organizationId,
        organizationId,
      ]);
    } finally {
      await client.close();
    }
    return organizationId;
  }

  // The exact document shapes migration 0025 wrote: `granted` and the audit `after` snapshot
  // predate the `meters` field slice 3 added. A strict read would throw for every such row.
  const PRE_METERS_GRANTED = '{"seats":{"max":null},"canInviteMembers":true}';
  const PRE_METERS_SNAPSHOT =
    '{"granted":{"seats":{"max":null},"canInviteMembers":true},"overrides":{}}';
  const BACKFILL_PLAN_VERSION = "2753dc123b7b4fd0d9ac36dbc00f6e676737fbf6fdcc19e2b79ff930dab6f51d";

  async function seedPreMetersOrganization(): Promise<string> {
    const organizationId = await seedOrganization();
    const client = await createPostgresQueryRuntime(postgres.getConnectionUri());

    try {
      await client.query(
        `insert into organization_entitlements
           (organization_id, granted, overrides, plan_id, plan_version, stamped_at, updated_at)
         values ($1, $2::jsonb, '{}'::jsonb, null, $3, now(), now())`,
        [organizationId, PRE_METERS_GRANTED, BACKFILL_PLAN_VERSION],
      );
      await client.query(
        `insert into entitlement_changes
           (organization_id, actor, source, before, after, reason)
         values ($1, null, 'provisioning', null, $2::jsonb, $3)`,
        [organizationId, PRE_METERS_SNAPSHOT, "Backfilled unlimited entitlements."],
      );
    } finally {
      await client.close();
    }
    return organizationId;
  }

  it("read() upgrades a granted document written before the meters field existed", async () => {
    const organizationId = await seedPreMetersOrganization();
    const service = new EntitlementsService(database, { seats: async () => 0 });

    const record = await service.read(organizationId);
    assert.deepEqual(record.granted.meters, { "executions.monthly": { limit: null } });
    assert.deepEqual(record.effective.meters, { "executions.monthly": { limit: null } });
    // The meter still enforces once it is read, proving the upgraded shape is usable, not just
    // parseable: consuming against the unlimited default succeeds.
    await service.consume(organizationId, "executions.monthly", 1);
  });

  it("history() upgrades audit snapshots written before the meters field existed", async () => {
    const organizationId = await seedPreMetersOrganization();
    const service = new EntitlementsService(database, { seats: async () => 0 });

    const history = await service.history(organizationId, 10);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.source, "provisioning");
    assert.deepEqual(history[0]?.effective.meters, { "executions.monthly": { limit: null } });
  });

  it("re-stamps idempotently and appends an audit row only on a real change", async () => {
    const organizationId = await seedOrganization();
    const service = new EntitlementsService(database, { seats: async () => 0 });
    const template = {
      seats: { max: 3 },
      canInviteMembers: false,
      meters: { "executions.monthly": { limit: null } },
    };
    await service.stamp(organizationId, template, { source: "plan_stamp", planId: "plan-solo" });
    const first = await service.read(organizationId);

    await service.stamp(organizationId, template, { source: "plan_stamp", planId: "plan-solo" });
    const second = await service.read(organizationId);
    assert.equal(second.stampedAt.getTime(), first.stampedAt.getTime());
    assert.equal((await service.history(organizationId, 10)).length, 1);

    await service.stamp(
      organizationId,
      { ...template, seats: { max: 5 } },
      { source: "plan_stamp", planId: "plan-solo" },
    );
    assert.equal((await service.history(organizationId, 10)).length, 2);
  });

  it("preserves both keys when two overrides race", async () => {
    const organizationId = await seedOrganization();
    const service = new EntitlementsService(database, { seats: async () => 0 });
    await service.stamp(organizationId, UNLIMITED_TEMPLATE, {
      source: "provisioning",
      planId: null,
    });

    // Two admins set different keys at the same time. With read-merge-write outside a
    // transaction the later write would clobber the earlier key; merging under the row lock
    // keeps both.
    await Promise.all([
      service.override(organizationId, { seats: { max: 3 } }, "admin-1", "cap seats"),
      service.override(
        organizationId,
        { meters: { "executions.monthly": { limit: 7 } } },
        "admin-2",
        "cap runs",
      ),
    ]);

    const record = await service.read(organizationId);
    assert.equal(record.overrides.seats?.max, 3);
    assert.equal(record.overrides.meters?.["executions.monthly"]?.limit, 7);
  });

  it("lets exactly the limit succeed under concurrent racing consumers, never over", async () => {
    const organizationId = await seedOrganization();
    const service = new EntitlementsService(database, { seats: async () => 0 });
    await service.stamp(
      organizationId,
      {
        seats: { max: null },
        canInviteMembers: true,
        meters: { "executions.monthly": { limit: 5 } },
      },
      { source: "provisioning", planId: null },
    );

    const CONCURRENT_CALLERS = 20;
    const LIMIT = 5;
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT_CALLERS }, () =>
        service.consume(organizationId, "executions.monthly", 1),
      ),
    );

    const succeeded = results.filter((result) => result.status === "fulfilled");
    const denied = results.filter(
      (result) => result.status === "rejected" && result.reason instanceof EntitlementDenied,
    );
    assert.equal(succeeded.length, LIMIT);
    assert.equal(denied.length, CONCURRENT_CALLERS - LIMIT);

    const usage = await service.usage(organizationId, "executions.monthly");
    assert.deepEqual(usage, { meter: "executions.monthly", used: LIMIT, limit: LIMIT });
  });

  it("lets every concurrent caller through when the meter is unlimited", async () => {
    const organizationId = await seedOrganization();
    const service = new EntitlementsService(database, { seats: async () => 0 });
    await service.stamp(organizationId, UNLIMITED_TEMPLATE, {
      source: "provisioning",
      planId: null,
    });

    const CONCURRENT_CALLERS = 20;
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT_CALLERS }, () =>
        service.consume(organizationId, "executions.monthly", 1),
      ),
    );

    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      CONCURRENT_CALLERS,
    );
    const usage = await service.usage(organizationId, "executions.monthly");
    assert.deepEqual(usage, {
      meter: "executions.monthly",
      used: CONCURRENT_CALLERS,
      limit: null,
    });
  });
});
