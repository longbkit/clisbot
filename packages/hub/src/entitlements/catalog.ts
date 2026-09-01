import { createHash } from "node:crypto";
import { z } from "zod";
import type { EntitlementDenialPayload } from "./denial.js";

/**
 * The entitlement catalog: caps and flags checked against live state, plus meter limits.
 * Meter *usage* (executions consumed so far this period) lives in `organization_usage`,
 * keyed by period — see the plan's data model. Only the limit lives here, so a meter
 * limit is overridable by an admin exactly like a cap.
 */
export const entitlementsSchema = z
  .object({
    seats: z
      .object({
        /** null means unlimited. */
        max: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    canInviteMembers: z.boolean(),
    meters: z
      .object({
        "executions.monthly": z
          .object({
            /** null means unlimited. */
            limit: z.number().int().nonnegative().nullable(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type Entitlements = z.infer<typeof entitlementsSchema>;

/**
 * Stored entitlement documents can predate any field the catalog added later: `meters`
 * landed after `seats`/`canInviteMembers`, and no migration upgraded the `granted` jsonb or
 * the audit snapshots written before it. Every read parses those documents, so a strict
 * parse throws for every pre-meters organization.
 *
 * This is the single versioned upgrade boundary. It parses leniently, fills the default a
 * later schema version introduced, then commits to the strict shape. When you add a required
 * field to `entitlementsSchema`, add its default here — every historical document keeps
 * reading, which is what stops the missing-backfill class of bug (shipped twice) from
 * recurring. `entitlementsSchema` stays the one authority on the current shape; this only
 * decides how an older shape maps onto it.
 */
const storedEntitlementsSchema = z.object({
  seats: z.object({ max: z.number().int().nonnegative().nullable() }),
  canInviteMembers: z.boolean(),
  meters: z
    .object({
      "executions.monthly": z
        .object({ limit: z.number().int().nonnegative().nullable() })
        .default({ limit: null }),
    })
    .default({ "executions.monthly": { limit: null } }),
});

/** Upgrade a stored entitlements document to the current strict shape. */
export function normalizeStoredEntitlements(raw: unknown): Entitlements {
  return entitlementsSchema.parse(storedEntitlementsSchema.parse(raw));
}

/** A template is entitlements data prior to being stamped onto an organization. */
export type EntitlementTemplate = Entitlements;

export const entitlementOverridesSchema = z
  .object({
    seats: z
      .object({
        max: z.number().int().nonnegative().nullable(),
      })
      .strict()
      .partial(),
    canInviteMembers: z.boolean(),
    meters: z
      .object({
        "executions.monthly": z
          .object({
            limit: z.number().int().nonnegative().nullable(),
          })
          .strict()
          .partial(),
      })
      .strict()
      .partial(),
  })
  .strict()
  .partial();

export type EntitlementOverrides = z.infer<typeof entitlementOverridesSchema>;

/** A patch is the set of hand-adjustments an admin applies over the granted template. */
export type EntitlementPatch = EntitlementOverrides;

/** Caps carry a numeric limit checked against a live count by `requireHeadroom`. */
export type CapKey = "seats";

/** Every cap, so `overages()` can walk them without a call site enumerating keys. */
export const CAP_KEYS: readonly CapKey[] = ["seats"];

/** Meters carry a numeric limit checked against period usage by `consume`. */
export type MeterKey = "executions.monthly";

/** Flags are boolean permissions checked by `requireFlag` — no count, no limit. */
export type FlagKey = "canInviteMembers";

/**
 * Which entitlement an override touches. The clearable keys are exactly the cap, flag, and
 * meter keys — one vocabulary, reused (see `clearOverrideKey`). An admin sets an override with
 * a patch and clears it by key; both are hand actions on `overrides`, never on `granted`.
 */
export type OverrideKey = CapKey | FlagKey | MeterKey;

/** Which kind of entitlement a denial is about; flags carry no numeric limit or current. */
export type EntitlementKind = "cap" | "meter" | "flag";

export const UNLIMITED_TEMPLATE: EntitlementTemplate = {
  seats: { max: null },
  canInviteMembers: true,
  meters: { "executions.monthly": { limit: null } },
};

/** The effective limit for a cap, or null when the cap is unlimited. */
export function capLimit(effective: Entitlements, cap: CapKey): number | null {
  const limits: Record<CapKey, number | null> = {
    seats: effective.seats.max,
  };
  return limits[cap];
}

/** The effective limit for a meter, or null when the meter is unlimited. */
export function meterLimit(effective: Entitlements, meter: MeterKey): number | null {
  const limits: Record<MeterKey, number | null> = {
    "executions.monthly": effective.meters["executions.monthly"].limit,
  };
  return limits[meter];
}

/** Whether a boolean flag is enabled in the effective entitlements. */
export function flagEnabled(effective: Entitlements, flag: FlagKey): boolean {
  const flags: Record<FlagKey, boolean> = {
    canInviteMembers: effective.canInviteMembers,
  };
  return flags[flag];
}

/**
 * The UTC-monthly period a moment in time falls into, as the timestamp of its start.
 * The single named function for period derivation — never inline this at call sites.
 */
export function meterPeriodStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Fold a patch into the existing overrides. Leaves in the patch win; keys the patch
 * omits keep their existing override. `granted` is never involved — a plan sync writes
 * `granted`, an admin writes `overrides`, and the two never touch.
 */
export function mergeOverrides(
  existing: EntitlementOverrides,
  patch: EntitlementPatch,
): EntitlementOverrides {
  return entitlementOverridesSchema.parse({
    ...existing,
    ...patch,
    ...(patch.seats === undefined ? {} : { seats: { ...existing.seats, ...patch.seats } }),
    ...(patch.meters === undefined
      ? {}
      : {
          meters: {
            "executions.monthly": {
              ...existing.meters?.["executions.monthly"],
              ...patch.meters["executions.monthly"],
            },
          },
        }),
  });
}

/**
 * Remove one hand-set override so the entitlement falls back to its plan-granted value. The
 * inverse of `mergeOverrides` for a single key — `override()` merges a value in, `clearOverride()`
 * takes it back out. `granted` is never involved, so clearing an override returns that key to
 * whatever the plan last stamped. Runs under the same row lock as the merge.
 */
export function clearOverrideKey(
  existing: EntitlementOverrides,
  key: OverrideKey,
): EntitlementOverrides {
  const next: EntitlementOverrides = { ...existing };
  if (key === "seats") {
    delete next.seats;
  } else if (key === "canInviteMembers") {
    delete next.canInviteMembers;
  } else {
    const meters = { ...next.meters };
    delete meters[key];
    if (Object.keys(meters).length === 0) delete next.meters;
    else next.meters = meters;
  }
  return entitlementOverridesSchema.parse(next);
}

/**
 * Thrown when a capped entitlement, metered usage, or a boolean flag denies an action. One
 * denial type covers all three kinds: caps and meters carry a numeric `limit`/`current`;
 * flags carry `null` for both because there is nothing to count. Mapped to a machine-readable
 * payload once at each boundary — never caught and reshaped per call site.
 */
export class EntitlementDenied extends Error {
  constructor(
    readonly entitlement: CapKey | MeterKey | FlagKey,
    readonly kind: EntitlementKind,
    readonly limit: number | null,
    readonly current: number | null,
  ) {
    super(
      kind === "flag"
        ? `entitlement denied: ${entitlement}`
        : `entitlement denied: ${entitlement} (${current}/${limit})`,
    );
    this.name = "EntitlementDenied";
  }

  /** The transport-neutral payload every boundary maps this denial to. */
  payload(): EntitlementDenialPayload {
    return {
      error: "entitlement_denied",
      entitlement: this.entitlement,
      kind: this.kind,
      limit: this.limit,
      current: this.current,
    };
  }
}

/** overrides always wins; a missing key falls back to the granted value. */
export function effectiveEntitlements(
  granted: Entitlements,
  overrides: EntitlementOverrides,
): Entitlements {
  return {
    seats: { max: overrides.seats?.max !== undefined ? overrides.seats.max : granted.seats.max },
    canInviteMembers: overrides.canInviteMembers ?? granted.canInviteMembers,
    meters: {
      "executions.monthly": {
        limit:
          overrides.meters?.["executions.monthly"]?.limit !== undefined
            ? overrides.meters["executions.monthly"].limit
            : granted.meters["executions.monthly"].limit,
      },
    },
  };
}

/** Stripe has no version counter, so `plan_version` is a content hash of the template. */
export function hashTemplate(template: EntitlementTemplate): string {
  return createHash("sha256").update(JSON.stringify(template)).digest("hex");
}
