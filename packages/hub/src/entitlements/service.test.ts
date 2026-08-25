import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { createMemoryDatabase } from "../db/memory.js";
import type { Database } from "../db/types.js";
import {
  EntitlementDenied,
  effectiveEntitlements,
  hashTemplate,
  normalizeStoredEntitlements,
  UNLIMITED_TEMPLATE,
} from "./catalog.js";
import { EntitlementsService, type EntitlementCounters } from "./service.js";

function serviceWith(
  database: Database = createMemoryDatabase(),
  counters: EntitlementCounters = { seats: async () => 0 },
): EntitlementsService {
  return new EntitlementsService(database, counters);
}

describe("EntitlementsService", () => {
  it("throws reading an organization that was never stamped", async () => {
    await assert.rejects(() => serviceWith().read("org-1"));
  });

  it("stamps the unlimited default template and reads it back as effective", async () => {
    const service = serviceWith();
    await service.stamp("org-1", UNLIMITED_TEMPLATE, {
      source: "provisioning",
      planId: null,
      actor: "user-1",
    });

    const record = await service.read("org-1");

    assert.deepEqual(record.granted, UNLIMITED_TEMPLATE);
    assert.deepEqual(record.overrides, {});
    assert.deepEqual(record.effective, UNLIMITED_TEMPLATE);
    assert.equal(record.planId, null);
    assert.equal(record.planVersion, hashTemplate(UNLIMITED_TEMPLATE));
  });

  it("re-stamping replaces granted without touching overrides", async () => {
    const service = serviceWith();
    await service.stamp("org-1", UNLIMITED_TEMPLATE, { source: "provisioning", planId: null });
    const capped = {
      seats: { max: 3 },
      canInviteMembers: false,
      meters: { "executions.monthly": { limit: null } },
    };

    await service.stamp("org-1", capped, { source: "plan_stamp", planId: "plan-solo" });
    const record = await service.read("org-1");

    assert.deepEqual(record.granted, capped);
    assert.equal(record.planId, "plan-solo");
    assert.deepEqual(record.overrides, {});
  });

  it("re-stamping the identical template and plan is a no-op", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const database = createMemoryDatabase();
    const service = new EntitlementsService(database, { seats: async () => 0 }, () => now);
    const template = {
      seats: { max: 3 },
      canInviteMembers: false,
      meters: { "executions.monthly": { limit: null } },
    };
    await service.stamp("org-1", template, { source: "plan_stamp", planId: "plan-solo" });
    const first = await service.read("org-1");

    // A later webhook replays the same plan state; nothing should move.
    now = new Date("2026-02-01T00:00:00.000Z");
    await service.stamp("org-1", template, { source: "plan_stamp", planId: "plan-solo" });
    const second = await service.read("org-1");

    assert.equal(second.stampedAt.getTime(), first.stampedAt.getTime());
    assert.equal(second.updatedAt.getTime(), first.updatedAt.getTime());
    assert.equal((await service.history("org-1", 10)).length, 1);
  });

  it("records plan provenance in the audit snapshot so identical templates stay distinguishable", async () => {
    const database = createMemoryDatabase();
    const service = new EntitlementsService(database, { seats: async () => 0 });
    const template = {
      seats: { max: 3 },
      canInviteMembers: true,
      meters: { "executions.monthly": { limit: null } },
    };
    await service.stamp("org-1", template, { source: "plan_stamp", planId: "plan-team" });

    const [change] = await database.listEntitlementChanges("org-1", 10);
    const after = z.object({ planId: z.string(), planVersion: z.string() }).parse(change?.after);
    assert.equal(after.planId, "plan-team");
    assert.equal(after.planVersion, hashTemplate(template));
  });

  it("rejects stamping an invalid template", async () => {
    const service = serviceWith();
    await assert.rejects(() =>
      service.stamp(
        "org-1",
        {
          seats: { max: -1 },
          canInviteMembers: true,
          meters: { "executions.monthly": { limit: null } },
        },
        { source: "provisioning", planId: null },
      ),
    );
  });

  it("keeps an override intact across a later plan re-stamp", async () => {
    const service = serviceWith();
    await service.stamp("org-1", UNLIMITED_TEMPLATE, { source: "provisioning", planId: null });
    await service.override("org-1", { seats: { max: 2 } }, "admin-1", "Custom deal");

    // The whole point of the granted/overrides split: a plan sync writes granted and must
    // never clobber a hand-set override.
    const restamped = {
      seats: { max: 25 },
      canInviteMembers: true,
      meters: { "executions.monthly": { limit: null } },
    };
    await service.stamp("org-1", restamped, { source: "plan_stamp", planId: "plan-team" });
    const record = await service.read("org-1");

    assert.deepEqual(record.granted, restamped);
    assert.deepEqual(record.overrides, { seats: { max: 2 } });
    assert.equal(record.effective.seats.max, 2);
  });

  it("merges successive override patches without dropping earlier keys", async () => {
    const service = serviceWith();
    await service.stamp("org-1", UNLIMITED_TEMPLATE, { source: "provisioning", planId: null });
    await service.override("org-1", { seats: { max: 4 } }, "admin-1", "Cap seats");
    await service.override("org-1", { canInviteMembers: false }, "admin-1", "Freeze invites");

    const record = await service.read("org-1");
    assert.deepEqual(record.overrides, { seats: { max: 4 }, canInviteMembers: false });
  });

  it("clearing an override returns that entitlement to its plan-granted value", async () => {
    const service = serviceWith();
    await service.stamp(
      "org-1",
      {
        seats: { max: 25 },
        canInviteMembers: true,
        meters: { "executions.monthly": { limit: null } },
      },
      { source: "plan_stamp", planId: "plan-team" },
    );
    await service.override("org-1", { seats: { max: 2 } }, "admin-1", "Trial cap");
    assert.equal((await service.read("org-1")).effective.seats.max, 2);

    // The path back from override(): the plan-granted 25 takes over once the hand-set 2 is cleared.
    await service.clearOverride("org-1", "seats", "admin-1", "Trial ended");
    const record = await service.read("org-1");
    assert.deepEqual(record.overrides, {});
    assert.equal(record.effective.seats.max, 25);
  });

  it("clearing one override leaves the other overrides untouched", async () => {
    const service = serviceWith();
    await service.stamp("org-1", UNLIMITED_TEMPLATE, { source: "provisioning", planId: null });
    await service.override("org-1", { seats: { max: 4 } }, "admin-1", "Cap seats");
    await service.override("org-1", { canInviteMembers: false }, "admin-1", "Freeze invites");

    await service.clearOverride("org-1", "seats", "admin-1", "Reopen seats");
    const record = await service.read("org-1");
    assert.deepEqual(record.overrides, { canInviteMembers: false });
    assert.equal(record.effective.seats.max, null);
  });

  it("records a clear in the audit trail as an override change with actor and reason", async () => {
    const service = serviceWith();
    await service.stamp("org-1", UNLIMITED_TEMPLATE, { source: "provisioning", planId: null });
    await service.override("org-1", { seats: { max: 2 } }, "owner-1", "Cap seats");
    await service.clearOverride("org-1", "seats", "owner-1", "Reset to plan default");

    const [latest] = await service.history("org-1", 10);
    assert.equal(latest?.source, "override");
    assert.equal(latest?.actor, "owner-1");
    assert.equal(latest?.reason, "Reset to plan default");
    assert.deepEqual(latest?.overrides, {});
  });

  it("reports an overage when the live count sits above a capped limit", async () => {
    const service = serviceWith(createMemoryDatabase(), { seats: async () => 5 });
    await service.stamp(
      "org-1",
      {
        seats: { max: 1 },
        canInviteMembers: false,
        meters: { "executions.monthly": { limit: null } },
      },
      { source: "plan_stamp", planId: "plan-free" },
    );

    assert.deepEqual(await service.overages("org-1"), [
      { entitlement: "seats", limit: 1, current: 5 },
    ]);
  });

  it("reports no overage when within the cap or the cap is unlimited", async () => {
    const withinCap = serviceWith(createMemoryDatabase(), { seats: async () => 1 });
    await withinCap.stamp(
      "org-1",
      {
        seats: { max: 1 },
        canInviteMembers: false,
        meters: { "executions.monthly": { limit: null } },
      },
      { source: "plan_stamp", planId: "plan-free" },
    );
    assert.deepEqual(await withinCap.overages("org-1"), []);

    const unlimited = serviceWith(createMemoryDatabase(), { seats: async () => 9999 });
    await unlimited.stamp("org-1", UNLIMITED_TEMPLATE, { source: "provisioning", planId: null });
    assert.deepEqual(await unlimited.overages("org-1"), []);
  });

  it("allows headroom under the cap and denies it at the cap", async () => {
    let seatsInUse = 1;
    const service = serviceWith(createMemoryDatabase(), { seats: async () => seatsInUse });
    await service.stamp(
      "org-1",
      {
        seats: { max: 2 },
        canInviteMembers: true,
        meters: { "executions.monthly": { limit: null } },
      },
      { source: "plan_stamp", planId: "plan-solo" },
    );

    await service.requireHeadroom("org-1", "seats");

    seatsInUse = 2;
    const denied = await service.requireHeadroom("org-1", "seats").then(
      () => undefined,
      (error: unknown) => error,
    );
    assert.ok(denied instanceof EntitlementDenied);
    assert.equal(denied.entitlement, "seats");
    assert.equal(denied.limit, 2);
    assert.equal(denied.current, 2);
  });

  it("passes a flag that is enabled and denies one that is disabled", async () => {
    const service = serviceWith();
    await service.stamp("org-1", UNLIMITED_TEMPLATE, { source: "provisioning", planId: null });

    await service.requireFlag("org-1", "canInviteMembers");

    await service.override("org-1", { canInviteMembers: false }, "admin-1", "Freeze invites");
    const denied = await service.requireFlag("org-1", "canInviteMembers").then(
      () => undefined,
      (error: unknown) => error,
    );
    assert.ok(denied instanceof EntitlementDenied);
    assert.equal(denied.entitlement, "canInviteMembers");
    assert.equal(denied.kind, "flag");
    assert.equal(denied.limit, null);
    assert.equal(denied.current, null);
  });

  it("never denies headroom for an unlimited cap", async () => {
    const service = serviceWith(createMemoryDatabase(), { seats: async () => 9999 });
    await service.stamp("org-1", UNLIMITED_TEMPLATE, { source: "provisioning", planId: null });
    await service.requireHeadroom("org-1", "seats");
  });

  it("enforces an overridden cap even when the plan grants more", async () => {
    let seatsInUse = 2;
    const service = serviceWith(createMemoryDatabase(), { seats: async () => seatsInUse });
    await service.stamp("org-1", UNLIMITED_TEMPLATE, { source: "provisioning", planId: null });
    await service.override("org-1", { seats: { max: 2 } }, "admin-1", "Trial cap");

    const denied = await service.requireHeadroom("org-1", "seats").then(
      () => undefined,
      (error: unknown) => error,
    );
    assert.ok(denied instanceof EntitlementDenied);

    seatsInUse = 1;
    await service.requireHeadroom("org-1", "seats");
  });

  it("records the audit trail newest first with actor and reason", async () => {
    const service = serviceWith();
    await service.stamp("org-1", UNLIMITED_TEMPLATE, {
      source: "provisioning",
      planId: null,
      actor: "owner-1",
    });
    await service.override("org-1", { seats: { max: 2 } }, "owner-1", "Founding-team cap");

    const history = await service.history("org-1", 10);

    assert.equal(history.length, 2);
    assert.equal(history[0]?.source, "override");
    assert.equal(history[0]?.actor, "owner-1");
    assert.equal(history[0]?.reason, "Founding-team cap");
    assert.equal(history[0]?.effective.seats.max, 2);
    assert.equal(history[1]?.source, "provisioning");
  });

  it("consumes usage under the meter limit and denies at the limit", async () => {
    const service = serviceWith();
    await service.stamp(
      "org-1",
      {
        seats: { max: null },
        canInviteMembers: true,
        meters: { "executions.monthly": { limit: 2 } },
      },
      { source: "provisioning", planId: null },
    );

    await service.consume("org-1", "executions.monthly", 1);
    assert.deepEqual(await service.usage("org-1", "executions.monthly"), {
      meter: "executions.monthly",
      used: 1,
      limit: 2,
    });

    await service.consume("org-1", "executions.monthly", 1);
    const denied = await service.consume("org-1", "executions.monthly", 1).then(
      () => undefined,
      (error: unknown) => error,
    );
    assert.ok(denied instanceof EntitlementDenied);
    assert.equal(denied.entitlement, "executions.monthly");
    assert.equal(denied.limit, 2);
    assert.equal(denied.current, 2);
    assert.deepEqual(await service.usage("org-1", "executions.monthly"), {
      meter: "executions.monthly",
      used: 2,
      limit: 2,
    });
  });

  it("rejects a non-positive or non-integer consume amount before touching usage", async () => {
    const service = serviceWith();
    await service.stamp(
      "org-1",
      {
        seats: { max: null },
        canInviteMembers: true,
        meters: { "executions.monthly": { limit: 5 } },
      },
      { source: "provisioning", planId: null },
    );

    for (const amount of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(() => service.consume("org-1", "executions.monthly", amount));
    }
    // A rejected amount never reached the meter.
    assert.equal((await service.usage("org-1", "executions.monthly")).used, 0);
  });

  it("never denies consumption for an unlimited meter", async () => {
    const service = serviceWith();
    await service.stamp("org-1", UNLIMITED_TEMPLATE, { source: "provisioning", planId: null });

    await service.consume("org-1", "executions.monthly", 1000);
    assert.deepEqual(await service.usage("org-1", "executions.monthly"), {
      meter: "executions.monthly",
      used: 1000,
      limit: null,
    });
  });

  it("enforces an overridden meter limit even when the plan grants more", async () => {
    const service = serviceWith();
    await service.stamp("org-1", UNLIMITED_TEMPLATE, { source: "provisioning", planId: null });
    await service.override(
      "org-1",
      { meters: { "executions.monthly": { limit: 1 } } },
      "admin-1",
      "Trial cap",
    );

    await service.consume("org-1", "executions.monthly", 1);
    const denied = await service.consume("org-1", "executions.monthly", 1).then(
      () => undefined,
      (error: unknown) => error,
    );
    assert.ok(denied instanceof EntitlementDenied);
  });

  it("resets usage in a new period", async () => {
    let now = new Date("2026-01-15T00:00:00.000Z");
    const database = createMemoryDatabase();
    const service = new EntitlementsService(database, { seats: async () => 0 }, () => now);
    await service.stamp(
      "org-1",
      {
        seats: { max: null },
        canInviteMembers: true,
        meters: { "executions.monthly": { limit: 1 } },
      },
      { source: "provisioning", planId: null },
    );

    await service.consume("org-1", "executions.monthly", 1);
    now = new Date("2026-02-01T00:00:00.000Z");
    await service.consume("org-1", "executions.monthly", 1);
    assert.deepEqual(await service.usage("org-1", "executions.monthly"), {
      meter: "executions.monthly",
      used: 1,
      limit: 1,
    });
  });
});

describe("effectiveEntitlements", () => {
  it("lets an override win over the granted value, key by key", () => {
    const effective = effectiveEntitlements(UNLIMITED_TEMPLATE, {
      seats: { max: 2 },
    });

    assert.deepEqual(effective, {
      seats: { max: 2 },
      canInviteMembers: true,
      meters: { "executions.monthly": { limit: null } },
    });
  });

  it("falls back to granted when no override is set", () => {
    const effective = effectiveEntitlements(UNLIMITED_TEMPLATE, {});
    assert.deepEqual(effective, UNLIMITED_TEMPLATE);
  });
});

describe("normalizeStoredEntitlements", () => {
  // Guards the versioned upgrade boundary: a document written before `meters` existed (the
  // shape migration 0025 backfilled) must still read. If a future required field is added to
  // the catalog without a default here, this test fails rather than the bug reaching a read.
  it("defaults meters to unlimited for a pre-meters granted document", () => {
    const normalized = normalizeStoredEntitlements({
      seats: { max: null },
      canInviteMembers: true,
    });
    assert.deepEqual(normalized, UNLIMITED_TEMPLATE);
  });

  it("keeps a fully current document unchanged", () => {
    const current = {
      seats: { max: 3 },
      canInviteMembers: false,
      meters: { "executions.monthly": { limit: 10 } },
    };
    assert.deepEqual(normalizeStoredEntitlements(current), current);
  });
});
