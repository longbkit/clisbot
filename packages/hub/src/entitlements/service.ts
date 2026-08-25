import { z } from "zod";
import type { Database, EntitlementChangeSource } from "../db/types.js";
import {
  CAP_KEYS,
  capLimit,
  effectiveEntitlements,
  EntitlementDenied,
  entitlementOverridesSchema,
  entitlementsSchema,
  flagEnabled,
  hashTemplate,
  meterLimit,
  meterPeriodStart,
  normalizeStoredEntitlements,
  type CapKey,
  type EntitlementOverrides,
  type EntitlementPatch,
  type Entitlements,
  type EntitlementTemplate,
  type FlagKey,
  type MeterKey,
  type OverrideKey,
} from "./catalog.js";

export interface Provenance {
  source: EntitlementChangeSource;
  /** The plan that produced this template, or null for self-hosted/hand-provisioned. */
  planId: string | null;
  actor?: string | null;
  reason?: string | null;
}

export interface OrganizationEntitlements {
  organizationId: string;
  granted: Entitlements;
  overrides: EntitlementOverrides;
  effective: Entitlements;
  planId: string | null;
  planVersion: string | null;
  stampedAt: Date;
  updatedAt: Date;
}

/** One entry in the append-only audit trail, resolved into typed, display-ready values. */
export interface EntitlementChange {
  id: string;
  actor: string | null;
  actorName: string | null;
  source: EntitlementChangeSource;
  reason: string | null;
  /** The effective entitlements the organization held immediately after this change. */
  effective: Entitlements;
  overrides: EntitlementOverrides;
  createdAt: Date;
}

/** cap key -> live count of what the cap governs, wired once at composition. */
export type EntitlementCounters = Record<CapKey, (organizationId: string) => Promise<number>>;

/** A meter's usage for its current period, resolved against the effective limit. */
export interface MeterUsage {
  meter: MeterKey;
  used: number;
  limit: number | null;
}

/** A cap's live count, resolved against the effective limit — the read-only usage display. */
export interface CapUsage {
  cap: CapKey;
  used: number;
  limit: number | null;
}

/**
 * A cap whose live count already exceeds its effective limit — the state a downgrade leaves
 * behind. Existing resources are grandfathered (never deleted to fit), so this is surfaced as a
 * banner, not an enforcement action; growth past the cap is what enforcement blocks.
 */
export interface EntitlementOverage {
  entitlement: CapKey;
  limit: number;
  current: number;
}

/**
 * CORE. What an organization is allowed to do. Never imports Stripe or anything
 * billing-related — `src/billing/` is the only writer that knows about plans.
 *
 * The counter registry is injected so a call site reads `requireHeadroom(orgId, "seats")`
 * and nothing else — the counting query never leaks out of this module.
 */
export class EntitlementsService {
  constructor(
    private readonly database: Database,
    private readonly counters: EntitlementCounters,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async read(organizationId: string): Promise<OrganizationEntitlements> {
    const row = await this.database.getOrganizationEntitlements(organizationId);
    if (row === undefined) {
      throw new Error(`organization has no entitlements record: ${organizationId}`);
    }
    const granted = normalizeStoredEntitlements(row.granted);
    const overrides = entitlementOverridesSchema.parse(row.overrides);
    return {
      organizationId: row.organizationId,
      granted,
      overrides,
      effective: effectiveEntitlements(granted, overrides),
      planId: row.planId,
      planVersion: row.planVersion,
      stampedAt: row.stampedAt,
      updatedAt: row.updatedAt,
    };
  }

  async stamp(
    organizationId: string,
    template: EntitlementTemplate,
    from: Provenance,
  ): Promise<void> {
    const granted = entitlementsSchema.parse(template);
    await this.database.stampOrganizationEntitlements({
      organizationId,
      granted,
      planId: from.planId,
      planVersion: hashTemplate(granted),
      source: from.source,
      actor: from.actor ?? null,
      reason: from.reason ?? null,
    });
  }

  /**
   * Fold a hand-set patch into the organization's overrides. `granted` is untouched, so
   * a later plan re-stamp never clobbers this deal — that split is the whole point.
   */
  async override(
    organizationId: string,
    patch: EntitlementPatch,
    by: string | null,
    reason: string,
  ): Promise<void> {
    // The patch — not a pre-merged document — goes to the persistence boundary, which merges it
    // against the row it holds locked. Read-merge-write here would let two concurrent overrides
    // read the same base and clobber each other; the merge must happen under the row lock.
    await this.database.overrideOrganizationEntitlements({
      organizationId,
      patch: entitlementOverridesSchema.parse(patch),
      actor: by,
      reason,
    });
  }

  /**
   * Take a hand-set override back out so the entitlement returns to its plan-granted value. The
   * path back from `override()`: without it a hand-set `seats.max` could never return to
   * plan-driven seats, which breaks the granted/overrides split's premise that overrides are the
   * exception. Same required reason and audit row as setting one; the removal happens under the
   * row lock, mirroring the merge.
   */
  async clearOverride(
    organizationId: string,
    key: OverrideKey,
    by: string | null,
    reason: string,
  ): Promise<void> {
    await this.database.clearOrganizationEntitlementsOverride({
      organizationId,
      key,
      actor: by,
      reason,
    });
  }

  /**
   * Reject the caller when a capped entitlement has no room left for one more. Unlimited
   * caps return immediately; otherwise the module counts the live usage itself.
   */
  async requireHeadroom(organizationId: string, cap: CapKey): Promise<void> {
    const { effective } = await this.read(organizationId);
    const limit = capLimit(effective, cap);
    if (limit === null) return;
    const current = await this.counters[cap](organizationId);
    if (current >= limit) throw new EntitlementDenied(cap, "cap", limit, current);
  }

  /**
   * The caps whose live count already sits above their effective limit — what a downgrade to a
   * smaller plan leaves behind once existing resources are grandfathered. Reads the same counters
   * as `requireHeadroom`, so "over the limit" and "no headroom for one more" agree. An empty list
   * means the organization is within every cap.
   */
  async overages(organizationId: string): Promise<EntitlementOverage[]> {
    const { effective } = await this.read(organizationId);
    const overages: EntitlementOverage[] = [];
    for (const cap of CAP_KEYS) {
      const limit = capLimit(effective, cap);
      if (limit === null) continue;
      const current = await this.counters[cap](organizationId);
      if (current > limit) overages.push({ entitlement: cap, limit, current });
    }
    return overages;
  }

  /**
   * Reject the caller when a boolean flag is disabled. Unlike a cap there is nothing to count;
   * an organization either has the permission or it does not.
   */
  async requireFlag(organizationId: string, flag: FlagKey): Promise<void> {
    const { effective } = await this.read(organizationId);
    if (!flagEnabled(effective, flag)) throw new EntitlementDenied(flag, "flag", null, null);
  }

  /**
   * Record `amount` of usage against a meter for its current period, denying when doing
   * so would exceed the effective limit. Backed by a single conditional upsert in the
   * database layer — see `Database.consumeOrganizationUsage` — so concurrent callers
   * racing the same cap cannot both succeed.
   */
  async consume(organizationId: string, meter: MeterKey, amount: number): Promise<void> {
    // A meter only ever counts up. A negative or fractional amount is a caller bug, not a quota
    // reset — reject it at the boundary so it can never reach the accumulating upsert.
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error(`consume amount must be a positive safe integer: ${amount}`);
    }
    const { effective } = await this.read(organizationId);
    const limit = meterLimit(effective, meter);
    const periodStart = meterPeriodStart(this.now());
    const result = await this.database.consumeOrganizationUsage({
      organizationId,
      meter,
      periodStart,
      amount,
      limit,
    });
    if (result !== undefined) return;
    if (limit === null) throw new Error("unreachable: an unlimited meter cannot be denied");
    const usage = await this.database.getOrganizationUsage(organizationId, meter, periodStart);
    throw new EntitlementDenied(meter, "meter", limit, usage?.used ?? 0);
  }

  /**
   * The reservation parameters for a meter: the current period and effective limit. The durable
   * engine passes these to execution creation so a unit is consumed atomically with — and only
   * when — an execution is created. Reading the limit here keeps the catalog lookup inside this
   * module; the caller never learns how a limit is resolved.
   */
  async meterReservation(
    organizationId: string,
    meter: MeterKey,
  ): Promise<{ meter: MeterKey; periodStart: Date; limit: number | null }> {
    const { effective } = await this.read(organizationId);
    return {
      meter,
      periodStart: meterPeriodStart(this.now()),
      limit: meterLimit(effective, meter),
    };
  }

  /**
   * The live count for a cap, resolved against its effective limit — what the Usage and operator
   * surfaces show as "in use". Reads the same counter as `requireHeadroom`, so "in use" agrees
   * with what enforcement blocks against. Symmetric with `usage()` for meters.
   */
  async capUsage(organizationId: string, cap: CapKey): Promise<CapUsage> {
    const { effective } = await this.read(organizationId);
    const limit = capLimit(effective, cap);
    const used = await this.counters[cap](organizationId);
    return { cap, used, limit };
  }

  /** The current period's usage for a meter, resolved against the effective limit. */
  async usage(organizationId: string, meter: MeterKey): Promise<MeterUsage> {
    const { effective } = await this.read(organizationId);
    const periodStart = meterPeriodStart(this.now());
    const record = await this.database.getOrganizationUsage(organizationId, meter, periodStart);
    return { meter, used: record?.used ?? 0, limit: meterLimit(effective, meter) };
  }

  async history(organizationId: string, limit: number): Promise<EntitlementChange[]> {
    const changes = await this.database.listEntitlementChanges(organizationId, limit);
    return changes.map((change) => {
      const after = normalizeAuditSnapshot(change.after);
      return {
        id: change.id,
        actor: change.actor,
        actorName: change.actorName,
        source: change.source,
        reason: change.reason,
        effective: effectiveEntitlements(after.granted, after.overrides),
        overrides: after.overrides,
        createdAt: change.createdAt,
      };
    });
  }
}

/**
 * The `{ granted, overrides }` snapshot every audit row stores as its before/after. `granted`
 * passes through the same versioned upgrade boundary as a live read, so snapshots written
 * before `meters` existed still resolve.
 */
const auditSnapshotSchema = z.object({ granted: z.unknown(), overrides: z.unknown() });

function normalizeAuditSnapshot(raw: unknown): {
  granted: Entitlements;
  overrides: EntitlementOverrides;
} {
  const snapshot = auditSnapshotSchema.parse(raw);
  return {
    granted: normalizeStoredEntitlements(snapshot.granted),
    overrides: entitlementOverridesSchema.parse(snapshot.overrides ?? {}),
  };
}
