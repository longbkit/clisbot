import type { AuthServer } from "../auth/server.js";
import type { Database, EntitlementChangeSource } from "../db/types.js";
import type { EntitlementsService } from "../entitlements/service.js";
import { resolveRouteTenant } from "../projects/access.js";

const HISTORY_LIMIT = 20;

export interface UsageRouteScope {
  organizationSlug: string;
}

/** A capped or metered resource's effective limit and current use. `null` limit is unlimited. */
export interface UsageMeasure {
  used: number;
  limit: number | null;
}

export interface UsageLimitsView {
  seats: UsageMeasure;
  canInviteMembers: boolean;
  executionsMonthly: UsageMeasure;
}

export interface UsageHistoryEntry {
  id: string;
  source: EntitlementChangeSource;
  reason: string | null;
  actorName: string | null;
  createdAt: string;
}

/**
 * The org-scoped, read-only usage surface: what an organization is limited to and how much of it
 * is in use, plus the change history. No billing dependency — it renders identically on
 * self-hosted and hosted, so a team can always see its own limits and usage. Customers never edit
 * here; setting limits is the instance operator's job.
 */
export interface UsageSnapshot {
  organization: { name: string; slug: string };
  limits: UsageLimitsView;
  history: UsageHistoryEntry[];
}

/**
 * Resolves through the organization's own membership (`resolveRouteTenant`), so any member can
 * read it and no one can read another organization's usage. The operator surface — which reads
 * organizations it does not belong to — deliberately does not share this path.
 */
export class UsageDashboard {
  constructor(
    private readonly database: Database,
    private readonly auth: AuthServer,
    private readonly entitlements: EntitlementsService,
  ) {}

  async snapshot(request: Request, scope: UsageRouteScope): Promise<UsageSnapshot> {
    const { tenant } = await resolveRouteTenant(this.auth, this.database, request, {
      organizationSlug: scope.organizationSlug,
    });
    const organizationId = tenant.organization.id;
    const [record, seats, executions, history] = await Promise.all([
      this.entitlements.read(organizationId),
      this.entitlements.capUsage(organizationId, "seats"),
      this.entitlements.usage(organizationId, "executions.monthly"),
      this.entitlements.history(organizationId, HISTORY_LIMIT),
    ]);
    return {
      organization: { name: tenant.organization.name, slug: tenant.organization.slug },
      limits: {
        seats: { used: seats.used, limit: seats.limit },
        canInviteMembers: record.effective.canInviteMembers,
        executionsMonthly: { used: executions.used, limit: executions.limit },
      },
      history: history.map((change) => ({
        id: change.id,
        source: change.source,
        reason: change.reason,
        actorName: change.actorName,
        createdAt: change.createdAt.toISOString(),
      })),
    };
  }
}
