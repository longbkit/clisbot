import type { AccountAccessValue } from "../auth/organization-access.js";
import type { Database, EntitlementChangeSource, OperatorOrganizationRecord } from "../db/types.js";
import type {
  Entitlements,
  EntitlementOverrides,
  EntitlementPatch,
  OverrideKey,
} from "../entitlements/catalog.js";
import type {
  EntitlementChange,
  EntitlementOverage,
  EntitlementsService,
  MeterUsage,
  OrganizationEntitlements,
} from "../entitlements/service.js";

const HISTORY_LIMIT = 20;

/**
 * The account resolution the operator surface needs — nothing more than "who is this, and are
 * they an operator". `AuthServer` satisfies it; a test can inject a faithful fake without standing
 * up the whole auth stack. The operator flag it returns is the sole authorization input.
 */
export interface OperatorAccountResolver {
  resolveAccount(request: Request): Promise<AccountAccessValue>;
}

export interface OperatorRouteScope {
  organizationSlug: string;
}

export interface OperatorOverrideInput {
  patch: EntitlementPatch;
  reason: string;
}

export interface OperatorClearOverrideInput {
  key: OverrideKey;
  reason: string;
}

/** Refused because the caller is not an instance operator. The server-side guard — hiding the nav
 * is presentation, this is the authorization. Every operator read and write passes through it. */
export class OperatorForbiddenError extends Error {
  constructor() {
    super("instance-operator access is required");
    this.name = "OperatorForbiddenError";
  }
}

/** The operator named an organization slug that does not exist. */
export class OperatorOrganizationNotFoundError extends Error {
  constructor() {
    super("organization not found");
    this.name = "OperatorOrganizationNotFoundError";
  }
}

export interface OperatorEntitlementsView {
  granted: Entitlements;
  overrides: EntitlementOverrides;
  effective: Entitlements;
  planId: string | null;
  stampedAt: string;
  updatedAt: string;
}

export interface OperatorHistoryEntry {
  id: string;
  actor: string | null;
  actorName: string | null;
  source: EntitlementChangeSource;
  reason: string | null;
  effective: Entitlements;
  overrides: EntitlementOverrides;
  createdAt: string;
}

export interface OperatorSnapshot {
  organization: OperatorOrganizationRecord;
  entitlements: OperatorEntitlementsView;
  seatsInUse: number;
  usage: MeterUsage;
  overages: EntitlementOverage[];
  history: OperatorHistoryEntry[];
}

/**
 * The instance-operator back office: view and edit any organization's entitlements, regardless of
 * membership. Its resolution is deliberately not `resolveRouteTenant` — that is a membership read,
 * and an operator acts on organizations it does not belong to. Instead every method gates on the
 * operator flag (`requireOperator`) and resolves the organization by slug through a dedicated
 * `Database.findOrganizationForOperator`, so widening this path never loosens org isolation.
 */
export class OperatorConsole {
  constructor(
    private readonly database: Database,
    private readonly accounts: OperatorAccountResolver,
    private readonly entitlements: EntitlementsService,
  ) {}

  async listOrganizations(request: Request): Promise<OperatorOrganizationRecord[]> {
    await this.requireOperator(request);
    return this.database.listOrganizationsForOperator();
  }

  async snapshot(request: Request, scope: OperatorRouteScope): Promise<OperatorSnapshot> {
    await this.requireOperator(request);
    const organization = await this.resolveOrganization(scope.organizationSlug);
    return this.buildSnapshot(organization);
  }

  async override(
    request: Request,
    scope: OperatorRouteScope,
    input: OperatorOverrideInput,
  ): Promise<OperatorSnapshot> {
    const actor = await this.requireOperator(request);
    const organization = await this.resolveOrganization(scope.organizationSlug);
    await this.entitlements.override(organization.id, input.patch, actor.account.id, input.reason);
    return this.buildSnapshot(organization);
  }

  async clearOverride(
    request: Request,
    scope: OperatorRouteScope,
    input: OperatorClearOverrideInput,
  ): Promise<OperatorSnapshot> {
    const actor = await this.requireOperator(request);
    const organization = await this.resolveOrganization(scope.organizationSlug);
    await this.entitlements.clearOverride(
      organization.id,
      input.key,
      actor.account.id,
      input.reason,
    );
    return this.buildSnapshot(organization);
  }

  private async requireOperator(request: Request): Promise<AccountAccessValue> {
    const account = await this.accounts.resolveAccount(request);
    if (!account.isInstanceOperator) throw new OperatorForbiddenError();
    return account;
  }

  private async resolveOrganization(slug: string): Promise<OperatorOrganizationRecord> {
    const organization = await this.database.findOrganizationForOperator(slug);
    if (organization === undefined) throw new OperatorOrganizationNotFoundError();
    return organization;
  }

  private async buildSnapshot(organization: OperatorOrganizationRecord): Promise<OperatorSnapshot> {
    const [record, seats, usage, overages, history] = await Promise.all([
      this.entitlements.read(organization.id),
      this.entitlements.capUsage(organization.id, "seats"),
      this.entitlements.usage(organization.id, "executions.monthly"),
      this.entitlements.overages(organization.id),
      this.entitlements.history(organization.id, HISTORY_LIMIT),
    ]);
    return {
      organization,
      entitlements: entitlementsView(record),
      seatsInUse: seats.used,
      usage,
      overages,
      history: history.map(historyView),
    };
  }
}

function entitlementsView(record: OrganizationEntitlements): OperatorEntitlementsView {
  return {
    granted: record.granted,
    overrides: record.overrides,
    effective: record.effective,
    planId: record.planId,
    stampedAt: record.stampedAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function historyView(change: EntitlementChange): OperatorHistoryEntry {
  return {
    id: change.id,
    actor: change.actor,
    actorName: change.actorName,
    source: change.source,
    reason: change.reason,
    effective: change.effective,
    overrides: change.overrides,
    createdAt: change.createdAt.toISOString(),
  };
}
