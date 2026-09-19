/**
 * Access grants for the organization-scoped management contract:
 *   catalog   GET    /organizations/:id/access-catalog[?include=team]
 *   list      GET    /organizations/:id/access-assignments[?include=team]
 *   create    POST   /organizations/:id/access-assignments
 *   batch     POST   /organizations/:id/access-assignments/batch
 *   remove    DELETE /organizations/:id/access-assignments/:assignmentId
 *   own       GET    /organizations/:id/access-assignments/effective[?include=team]
 *   member    GET    /organizations/:id/members/:membershipId/effective[?include=team]
 *   events    GET    /organizations/:id/access-events?limit=
 *
 * Organization Owners and Admins pass on their role. Everyone else passes the
 * grantor rule (`access/grantor.ts`): they see and change grants only on the
 * resources they can share, at most up to what they hold. A refusal is
 * `access_exceeds_grantor`.
 */
import { z } from "zod";
import {
  ACCESS_PRIVILEGES,
  AccessAssignmentBatchInputSchema,
  AccessAssignmentInputSchema,
  RESOURCE_ACCESS_LEVELS,
  type AccessAssignmentInput,
} from "../access/contract.js";
import { newlyAdministrator, recordAdministratorGranted } from "../access/administrator-notice.js";
import {
  ACCESS_EVENT_LIST_LIMIT,
  type AccessEventRecord,
  type AccessEventStore,
} from "../access/events.js";
import {
  bypassesGrantorRule,
  canShareResource,
  decideGrant,
  type GrantActor,
} from "../access/grantor.js";
import {
  AccessPolicyError,
  type AccessAssignmentRecord,
  type AccessResourceRecord,
  type AccessStore,
  type EffectiveAccessRecord,
} from "../access/store.js";
import { ProductRequestError, type OrganizationAccessValue } from "../auth/organization-access.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import type { NotificationMailer } from "../invitations/index.js";
import { includesTeamResources, parseBody, problem } from "./request.js";

const eventsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(ACCESS_EVENT_LIST_LIMIT.max)
      .default(ACCESS_EVENT_LIST_LIMIT.default),
  })
  .strict();

export interface AccessDelegationDependencies {
  runtime: DatabaseRuntime;
  access: AccessStore;
  events: AccessEventStore;
  notificationMailer?: NotificationMailer | undefined;
  requireMutation: (request: Request) => void;
  revokeOrganizationAccessLeases: (organizationId: string) => Promise<void>;
}

export class AccessDelegationApi {
  constructor(private readonly deps: AccessDelegationDependencies) {}

  async accessCatalog(request: Request, access: OrganizationAccessValue): Promise<Response> {
    const viewer = await this.viewer(access);
    const resources = await this.deps.access.listResources(access.organization.id);
    const visible = shareableResources(viewer, resources);
    if (visible.length === 0) throw new ProductRequestError(403, "forbidden");
    return Response.json({
      privileges: ACCESS_PRIVILEGES,
      accessLevels: RESOURCE_ACCESS_LEVELS,
      resources: omitTeamResources(request, visible),
    });
  }

  async accessEvents(request: Request, access: OrganizationAccessValue): Promise<Response> {
    if (!access.capabilities.manageResources) throw new ProductRequestError(403, "forbidden");
    const query = eventsQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success) throw new ProductRequestError(400, "invalid_request");
    const events = await this.deps.events.list(access.organization.id, query.data.limit);
    return Response.json({ events: events.map(serializeAccessEvent) });
  }

  async handleAssignments(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
  ): Promise<Response> {
    const organizationId = access.organization.id;
    if (request.method === "GET" && segments.length === 4 && segments[3] === "effective") {
      return this.effectiveAccess(request, requestId, {
        organizationId,
        userId: access.account.id,
        membershipId: access.membership.id,
      });
    }
    if (request.method === "GET" && segments.length === 3) {
      return this.listAssignments(request, access);
    }
    if (request.method === "POST" && segments.length === 3) {
      this.deps.requireMutation(request);
      const input = await parseBody(request, AccessAssignmentInputSchema);
      const [assignment] = await this.save(request, access, [input]);
      return Response.json(serializeAssignment(assignment!), { status: 201 });
    }
    if (request.method === "POST" && segments.length === 4 && segments[3] === "batch") {
      this.deps.requireMutation(request);
      const input = await parseBody(request, AccessAssignmentBatchInputSchema);
      const assignments = await this.save(request, access, input.assignments);
      return Response.json({ assignments: assignments.map(serializeAssignment) }, { status: 201 });
    }
    if (request.method === "DELETE" && segments.length === 4) {
      this.deps.requireMutation(request);
      return this.remove(requestId, access, segments[3]!);
    }
    return problem(requestId, 404, "not_found", "No management resource matches this path.");
  }

  /** Another Member's effective access, for Organization Admins and the Member themselves. */
  async memberEffectiveAccess(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    membershipId: string,
  ): Promise<Response> {
    const self = membershipId === access.membership.id;
    if (!self && !access.capabilities.manageResources && !access.capabilities.manageMembers) {
      throw new ProductRequestError(403, "forbidden");
    }
    return this.effectiveAccess(request, requestId, {
      organizationId: access.organization.id,
      membershipId,
    });
  }

  private async effectiveAccess(
    request: Request,
    requestId: string,
    member: { organizationId: string; membershipId: string; userId?: string },
  ): Promise<Response> {
    const effective = await this.deps.access.listEffectiveAccess(member);
    if (effective === undefined) {
      return problem(
        requestId,
        404,
        "membership_unavailable",
        "Organization membership is unavailable.",
      );
    }
    const grants: EffectiveAccessRecord["grants"] = includesTeamResources(request)
      ? effective.grants
      : // COMPAT(team-resource-kind): added 2026-09-19, remove after 2027-03-19.
        effective.grants.filter(({ resource }) => resource.kind !== "team");
    return Response.json({ owner: effective.owner, grants });
  }

  private async listAssignments(
    request: Request,
    access: OrganizationAccessValue,
  ): Promise<Response> {
    const viewer = await this.viewer(access);
    const organizationId = access.organization.id;
    const [assignments, resources] = await Promise.all([
      this.deps.access.listAssignments(organizationId),
      this.deps.access.listResources(organizationId),
    ]);
    if (shareableResources(viewer, resources).length === 0) {
      throw new ProductRequestError(403, "forbidden");
    }
    const visible = assignments.filter((row) =>
      canShareResource(
        viewer,
        { kind: row.resourceKind, id: row.resourceId, parent: null },
        resources,
      ),
    );
    return Response.json({
      assignments: omitTeamResources(request, visible).map(serializeAssignment),
    });
  }

  private async save(
    request: Request,
    access: OrganizationAccessValue,
    inputs: readonly AccessAssignmentInput[],
  ): Promise<AccessAssignmentRecord[]> {
    const organizationId = access.organization.id;
    const previous = await this.deps.access.listAssignments(organizationId);
    const candidates = await this.withoutHeldHostConnect(access, inputs, previous);
    await this.requireWithinGrantor(access, candidates, previous);
    const saved = await this.deps.access.saveAssignments(
      organizationId,
      candidates,
      access.account.id,
    );
    await this.deps.revokeOrganizationAccessLeases(organizationId);
    const promoted = newlyAdministrator(previous, saved);
    if (promoted.length > 0) {
      await recordAdministratorGranted(
        {
          runtime: this.deps.runtime,
          events: this.deps.events,
          mailer: this.deps.notificationMailer,
          organizationId,
          actor: { userId: access.account.id, name: access.account.name },
          // The Hub serves the app, so the grant request's origin opens its Access page.
          appOrigin: new URL(request.url).origin,
          resources: await this.deps.access.listResources(organizationId),
        },
        promoted,
      );
    }
    return saved;
  }

  private async remove(
    requestId: string,
    access: OrganizationAccessValue,
    assignmentId: string,
  ): Promise<Response> {
    const organizationId = access.organization.id;
    const existing = (await this.deps.access.listAssignments(organizationId)).find(
      ({ id }) => id === assignmentId,
    );
    if (existing === undefined) {
      return problem(
        requestId,
        404,
        "access_assignment_unavailable",
        "Access assignment is unavailable.",
      );
    }
    await this.requireWithinGrantor(access, [existing], []);
    await this.deps.access.deleteAssignment(organizationId, assignmentId);
    await this.deps.revokeOrganizationAccessLeases(organizationId);
    return new Response(null, { status: 204 });
  }

  /**
   * A Project sharer who cannot share the Host never sees the grantee's Host
   * row, so the app sends a Connect-only Host row with every Project grant
   * (`isConnectForSharedProject` in `access/grantor.ts`). When the grantee's
   * own Host row already connects, writing it would replace that row, so it is
   * dropped instead.
   */
  private async withoutHeldHostConnect(
    access: OrganizationAccessValue,
    inputs: readonly AccessAssignmentInput[],
    previous: readonly AccessAssignmentRecord[],
  ): Promise<AccessAssignmentInput[]> {
    if (inputs.length < 2) return [...inputs];
    const viewer = await this.viewer(access);
    if (bypassesGrantorRule(viewer.role)) return [...inputs];
    const resources = await this.deps.access.listResources(access.organization.id);
    return inputs.filter((input) => {
      if (!isConnectOnlyHostRow(input)) return true;
      const host = resources.find(({ kind, id }) => kind === "daemon" && id === input.resourceId);
      if (host === undefined || canShareResource(viewer, host, resources)) return true;
      return !previous.some(
        (row) =>
          row.subjectKind === input.subjectKind &&
          row.subjectId === input.subjectId &&
          row.resourceKind === "daemon" &&
          row.resourceId === input.resourceId &&
          row.privileges.includes("daemon.connect"),
      );
    });
  }

  /**
   * Every candidate, and the row it replaces, must sit within what the actor
   * holds: changing a grant above your level is as much an escalation as
   * creating one.
   */
  private async requireWithinGrantor(
    access: OrganizationAccessValue,
    candidates: readonly AccessAssignmentInput[],
    previous: readonly AccessAssignmentRecord[],
  ): Promise<void> {
    const viewer = await this.viewer(access);
    if (bypassesGrantorRule(viewer.role)) return;
    const resources = await this.deps.access.listResources(access.organization.id);
    for (const candidate of candidates) {
      const current = previous.find(
        (row) =>
          row.subjectKind === candidate.subjectKind &&
          row.subjectId === candidate.subjectId &&
          row.resourceKind === candidate.resourceKind &&
          row.resourceId === candidate.resourceId,
      );
      for (const grant of current === undefined ? [candidate] : [current, candidate]) {
        const decision = decideGrant(viewer, grant, resources);
        if (!decision.allowed) {
          throw new AccessPolicyError("access_exceeds_grantor", decision.reason);
        }
      }
    }
  }

  private async viewer(access: OrganizationAccessValue): Promise<GrantActor> {
    const role = access.membership.role;
    if (bypassesGrantorRule(role)) return { role, assignments: [] };
    return {
      role,
      assignments: await this.deps.access.listMemberAssignments(access.organization.id, {
        membershipId: access.membership.id,
        userId: access.account.id,
      }),
    };
  }
}

function isConnectOnlyHostRow(input: AccessAssignmentInput): boolean {
  return (
    input.resourceKind === "daemon" &&
    input.privileges.length === 1 &&
    input.privileges[0] === "daemon.connect" &&
    Object.keys(input.constraints).length === 0
  );
}

function shareableResources(
  viewer: GrantActor,
  resources: readonly AccessResourceRecord[],
): AccessResourceRecord[] {
  return resources.filter((resource) => canShareResource(viewer, resource, resources));
}

/**
 * COMPAT(team-resource-kind): added 2026-09-19, remove after 2027-03-19. Older
 * apps parse `resourceKind` with a closed enum; they get Team rows only by
 * asking (`?include=team`).
 */
function omitTeamResources<Row extends { resourceKind: string } | { kind: string }>(
  request: Request,
  rows: readonly Row[],
): Row[] {
  if (includesTeamResources(request)) return [...rows];
  return rows.filter((row) => ("kind" in row ? row.kind : row.resourceKind) !== "team");
}

function serializeAccessEvent(event: AccessEventRecord) {
  return { ...event, createdAt: event.createdAt.toISOString() };
}

function serializeAssignment(assignment: AccessAssignmentRecord) {
  return {
    ...assignment,
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
  };
}
