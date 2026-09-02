import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { dump, load } from "js-yaml";
import { z } from "zod";
import {
  ACCESS_PRIVILEGES,
  AccessAssignmentInputSchema,
  PROJECT_ACCESS_LEVELS,
} from "../access/contract.js";
import { AccessPolicyError, AccessStore } from "../access/store.js";
import { ProductRequestError, type OrganizationAccessValue } from "../auth/organization-access.js";
import type { BrowserOrganizationAccess } from "../auth/browser-organization-access.js";
import { AccountFileSchema, OrgPolicySchema } from "../channels/config/schema.js";
import { loadChannelControlPlane } from "../channels/control-plane.js";
import { ControlPlaneHttpError, deployRevision } from "../channels/http/operations.js";
import type { ChannelSupervisor } from "../channels/supervisor/types.js";
import {
  CHANNELS_DIRECTORY,
  CHANNEL_POLICY_PATH,
  type HubBundleFile,
} from "../config/bundle-contract.js";
import {
  ChannelConfigurationConflictError,
  OrganizationTriggerConflictError,
} from "../db/errors.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";
import type { Database, OrganizationTriggerRecord } from "../db/types.js";
import { reportFailure } from "../failures/index.js";
import { AccessTicketError, AccessTicketService } from "../managed-access/tickets.js";
import { TriggerDocumentError } from "../triggers/configuration/index.js";
import { OrganizationTriggerStore } from "../triggers/store.js";

const ticketRequestSchema = z.object({ clientId: z.string().min(1).max(256) }).strict();
const identityRequestSchema = z
  .object({
    memberId: z.string().min(1),
    connectionId: z.string().min(1),
    externalSubjectId: z.string().min(1),
    displayName: z.string().min(1).nullable().optional(),
  })
  .strict();
const channelConfigurationRequestSchema = z
  .object({
    expectedRevisionId: z.string().uuid().nullable(),
    policy: OrgPolicySchema,
    accounts: z.array(AccountFileSchema),
  })
  .strict();
const automationRequestSchema = z
  .object({
    yaml: z.string().min(1),
    expectedRevisionId: z.string().uuid().nullable(),
  })
  .strict();

/** Browser/app management contract; each operation delegates to an existing Hub domain owner. */
export class ManagementApi {
  constructor(
    private readonly options: {
      database: Database;
      runtime: DatabaseRuntime;
      auth: BrowserOrganizationAccess;
      access: AccessStore;
      tickets: AccessTicketService;
      channelSupervisor: ChannelSupervisor | null;
    },
  ) {}

  async handle(request: Request): Promise<Response> {
    const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
    try {
      return await this.dispatch(request, requestId);
    } catch (error) {
      if (error instanceof ManagementResponse) return error.response;
      if (error instanceof ProductRequestError) return error.response();
      if (error instanceof AccessPolicyError) {
        const status = error.code === "invalid_assignment" ? 400 : 404;
        return problem(requestId, status, error.code, error.message);
      }
      if (error instanceof AccessTicketError) {
        return problem(requestId, 403, error.code, error.message);
      }
      if (
        error instanceof ChannelConfigurationConflictError ||
        error instanceof OrganizationTriggerConflictError
      ) {
        return problem(requestId, 409, "revision_conflict", error.message);
      }
      if (error instanceof ControlPlaneHttpError) {
        return problem(requestId, error.status, error.code, error.detail);
      }
      if (error instanceof TriggerDocumentError) {
        return problem(requestId, 422, "invalid_automation", error.message);
      }
      reportFailure(error, {
        operation: "management_api.request",
        component: "management-api",
        status: 500,
      });
      return problem(requestId, 500, "request_failed", "The request could not be completed.");
    }
  }

  private async dispatch(request: Request, requestId: string): Promise<Response> {
    const method = request.method.toUpperCase();
    const segments = managementSegments(request);
    if (segments[0] !== "organizations" || segments[1] === undefined) {
      return problem(requestId, 404, "not_found", "No management resource matches this path.");
    }
    const organizationId = segments[1];
    const access = await this.organizationAccess(request, organizationId);
    const resource = segments[2];

    if (method === "GET" && segments.length === 3 && resource === "access-catalog") {
      return Response.json({
        privileges: ACCESS_PRIVILEGES,
        projectAccessLevels: PROJECT_ACCESS_LEVELS,
      });
    }
    if (method === "GET" && segments.length === 3 && resource === "members") {
      return this.listMembers(organizationId);
    }
    if (method === "GET" && segments.length === 3 && resource === "teams") {
      return this.listTeams(organizationId);
    }
    if (resource === "connections") {
      return this.handleConnections(request, requestId, access, segments);
    }
    if (resource === "channel-configuration") {
      return this.handleChannelConfiguration(request, requestId, access, segments);
    }
    if (resource === "automations") {
      return this.handleAutomations(request, requestId, access, segments);
    }
    if (resource === "access-assignments") {
      return this.handleAccessAssignments(request, requestId, access, segments);
    }
    if (resource === "channel-identities") {
      return this.handleChannelIdentities(request, requestId, access, segments);
    }
    if (resource === "daemons") {
      return this.handleDaemons(request, requestId, access, segments);
    }
    return problem(requestId, 404, "not_found", "No management resource matches this path.");
  }

  private async handleAccessAssignments(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
  ): Promise<Response> {
    this.requireAccessManager(access);
    if (request.method === "GET" && segments.length === 3) {
      return Response.json({
        assignments: serializeAssignments(
          await this.options.access.listAssignments(access.organization.id),
        ),
      });
    }
    if (request.method === "POST" && segments.length === 3) {
      this.requireMutation(request);
      const input = await parseBody(request, AccessAssignmentInputSchema);
      const assignment = await this.options.access.saveAssignment(
        access.organization.id,
        input,
        access.account.id,
      );
      return Response.json(serializeAssignment(assignment), { status: 201 });
    }
    if (request.method === "DELETE" && segments.length === 4) {
      this.requireMutation(request);
      const deleted = await this.options.access.deleteAssignment(
        access.organization.id,
        segments[3]!,
      );
      return deleted
        ? new Response(null, { status: 204 })
        : problem(
            requestId,
            404,
            "access_assignment_unavailable",
            "Access assignment is unavailable.",
          );
    }
    return problem(requestId, 404, "not_found", "No management resource matches this path.");
  }

  private async handleConnections(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
  ): Promise<Response> {
    if (request.method !== "GET" || segments.length !== 3) {
      return problem(requestId, 404, "not_found", "No management resource matches this path.");
    }
    const usage = await this.options.database.organizationConnectionUsage(access.organization.id);
    const telegram = await this.options.runtime
      .drizzle()
      .select({
        id: schema.telegramConnections.id,
        name: schema.telegramConnections.accountId,
        identity: schema.telegramConnections.externalIdentity,
      })
      .from(schema.telegramConnections)
      .where(eq(schema.telegramConnections.organizationId, access.organization.id))
      .orderBy(asc(schema.telegramConnections.accountId));
    return Response.json({
      connections: [
        ...usage.github.map((connection) => ({
          id: connection.id,
          provider: "github",
          name: connection.slug,
          externalName: connection.accountLogin,
          status: connection.status,
        })),
        ...usage.discord.map((connection) => ({
          id: connection.id,
          provider: "discord",
          name: connection.slug,
          externalName: connection.guildName,
          status: "active",
        })),
        ...usage.slack.map((connection) => ({
          id: connection.id,
          provider: "slack",
          name: connection.slug,
          externalName: connection.teamName,
          status: "active",
        })),
        ...usage.linear.map((connection) => ({
          id: connection.id,
          provider: "linear",
          name: connection.slug,
          externalName: connection.linearOrganizationName,
          status: "active",
        })),
        ...telegram.map((connection) => ({
          id: connection.id,
          provider: "telegram",
          name: connection.name,
          externalName: externalIdentityLabel(connection.identity),
          status: "active",
        })),
      ],
    });
  }

  private async handleChannelConfiguration(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
  ): Promise<Response> {
    if (segments.length !== 3) {
      return problem(requestId, 404, "not_found", "No management resource matches this path.");
    }
    const snapshot = await loadChannelControlPlane(this.options.database, access.organization.id);
    if (request.method === "GET") {
      return Response.json(channelConfigurationView(snapshot));
    }
    if (request.method !== "PUT") {
      return problem(
        requestId,
        405,
        "method_not_allowed",
        "Use GET or PUT for Channel configuration.",
      );
    }
    this.requireMutation(request);
    this.requireAccessManager(access);
    const input = await parseBody(request, channelConfigurationRequestSchema);
    const files = writeChannelConfiguration(snapshot.files, input.policy, input.accounts);
    await deployRevision(this.options.database, snapshot, files, {
      createdByUserId: access.account.id,
      expectedRevisionId: input.expectedRevisionId,
    });
    const reconciliation = await this.options.channelSupervisor?.reconcile();
    const active = await loadChannelControlPlane(this.options.database, access.organization.id);
    return Response.json({
      ...channelConfigurationView(active),
      reconciliation: reconciliation ?? null,
    });
  }

  private async handleAutomations(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
  ): Promise<Response> {
    const store = new OrganizationTriggerStore(this.options.database, access.organization.id);
    if (request.method === "GET" && segments.length === 3) {
      const automations = await Promise.all(
        (await store.list()).map((automation) => automationView(store, automation)),
      );
      return Response.json({ automations });
    }
    if (!["POST", "PUT"].includes(request.method)) {
      return problem(
        requestId,
        405,
        "method_not_allowed",
        "Use GET, POST, or PUT for Automations.",
      );
    }
    this.requireMutation(request);
    this.requireAccessManager(access);
    const isCreate = request.method === "POST" && segments.length === 3;
    const isUpdate = request.method === "PUT" && segments.length === 4;
    if (!isCreate && !isUpdate) {
      return problem(requestId, 404, "not_found", "No management resource matches this path.");
    }
    const input = await parseBody(request, automationRequestSchema);
    const automation = await store.save({
      ...(isUpdate ? { triggerId: segments[3] } : {}),
      yaml: input.yaml,
      userId: access.account.id,
      expectedActiveRevisionId: input.expectedRevisionId,
    });
    return Response.json(await automationView(store, automation), { status: isCreate ? 201 : 200 });
  }

  private async handleChannelIdentities(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
  ): Promise<Response> {
    if (request.method === "GET" && segments.length === 3) {
      const identities = await this.options.access.listChannelIdentities(access.organization.id);
      const visible = access.capabilities.manageResources
        ? identities
        : identities.filter(({ memberId }) => memberId === access.membership.id);
      return Response.json({ identities: visible.map(serializeIdentity) });
    }
    this.requireAccessManager(access);
    if (request.method === "POST" && segments.length === 3) {
      this.requireMutation(request);
      const input = await parseBody(request, identityRequestSchema);
      const identity = await this.options.access.bindChannelIdentity({
        organizationId: access.organization.id,
        ...input,
        displayName: input.displayName ?? null,
        verificationMethod: "administrator",
        verifiedByUserId: access.account.id,
      });
      return Response.json(serializeIdentity(identity), { status: 201 });
    }
    if (request.method === "DELETE" && segments.length === 4) {
      this.requireMutation(request);
      const deleted = await this.options.access.deleteChannelIdentity(
        access.organization.id,
        segments[3]!,
      );
      return deleted
        ? new Response(null, { status: 204 })
        : problem(
            requestId,
            404,
            "channel_identity_unavailable",
            "Channel identity is unavailable.",
          );
    }
    return problem(requestId, 404, "not_found", "No management resource matches this path.");
  }

  private async handleDaemons(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
  ): Promise<Response> {
    if (request.method === "GET" && segments.length === 3) return this.listDaemons(access);
    const daemonId = segments[3];
    if (daemonId === undefined || segments.length !== 5) {
      return problem(requestId, 404, "not_found", "No management resource matches this path.");
    }
    if (request.method === "GET" && segments[4] === "projects") {
      return this.listDaemonProjects(requestId, access, daemonId);
    }
    if (request.method === "POST" && segments[4] === "access-tickets") {
      this.requireMutation(request);
      const input = await parseBody(request, ticketRequestSchema);
      const ticket = await this.options.tickets.issue({
        organizationId: access.organization.id,
        daemonId,
        userId: access.account.id,
        membershipId: access.membership.id,
        clientId: input.clientId,
      });
      return Response.json(
        { accessTicket: ticket.accessTicket, expiresAt: ticket.expiresAt.toISOString() },
        { status: 201, headers: { "cache-control": "no-store" } },
      );
    }
    return problem(requestId, 404, "not_found", "No management resource matches this path.");
  }

  private async listDaemonProjects(
    requestId: string,
    access: OrganizationAccessValue,
    daemonId: string,
  ): Promise<Response> {
    const authority = await this.options.access.resolveDaemonAccess({
      organizationId: access.organization.id,
      daemonId,
      userId: access.account.id,
      membershipId: access.membership.id,
    });
    if (authority === undefined) {
      return problem(requestId, 404, "daemon_unavailable", "Daemon is unavailable.");
    }
    const projects = await this.options.access.listDaemonProjects(access.organization.id, daemonId);
    const allowed =
      authority.resourceMode === "daemon"
        ? projects
        : projects.filter(({ projectId }) =>
            authority.projects.some((entry) => entry.projectId === projectId),
          );
    return Response.json({ projects: allowed.map(serializeDaemonProject) });
  }

  private async organizationAccess(request: Request, organizationId: string) {
    const access = await this.options.auth.resolveOrganizationAccess(request);
    if (access.organization.id !== organizationId) {
      throw new ProductRequestError(404, "organization_unavailable");
    }
    return access;
  }

  private requireMutation(request: Request): void {
    const rejected = this.options.auth.rejectCookieMutation(request);
    if (rejected !== undefined) throw new ManagementResponse(rejected);
  }

  private requireAccessManager(access: OrganizationAccessValue): void {
    if (!access.capabilities.manageResources) {
      throw new ProductRequestError(403, "forbidden");
    }
  }

  private async listDaemons(access: OrganizationAccessValue): Promise<Response> {
    const daemons = await this.options.database.listDaemonsForOrganization(access.organization.id);
    const visible = await Promise.all(
      daemons.map(async (daemon) => ({
        daemon,
        authority: await this.options.access.resolveDaemonAccess({
          organizationId: access.organization.id,
          daemonId: daemon.id,
          userId: access.account.id,
          membershipId: access.membership.id,
        }),
      })),
    );
    return Response.json({
      daemons: visible.flatMap(({ daemon, authority }) =>
        authority === undefined
          ? []
          : [
              {
                id: daemon.id,
                slug: daemon.slug,
                status: daemon.status,
                presence: daemon.presence,
                connectedAt: daemon.connectedAt?.toISOString() ?? null,
                lastSeenAt: daemon.lastSeenAt.toISOString(),
                canManage: authority.owner || authority.permissions.includes("daemon.manage"),
              },
            ],
      ),
    });
  }

  private async listMembers(organizationId: string): Promise<Response> {
    const rows = await this.options.runtime
      .drizzle()
      .select({
        id: schema.members.id,
        userId: schema.members.userId,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.members.role,
      })
      .from(schema.members)
      .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
      .where(eq(schema.members.organizationId, organizationId))
      .orderBy(asc(schema.users.name), asc(schema.users.email));
    return Response.json({ members: rows });
  }

  private async listTeams(organizationId: string): Promise<Response> {
    const database = this.options.runtime.drizzle();
    const [teams, memberships] = await Promise.all([
      database
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.organizationId, organizationId))
        .orderBy(asc(schema.teams.name)),
      database
        .select({ teamId: schema.teamMembers.teamId, userId: schema.teamMembers.userId })
        .from(schema.teamMembers)
        .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
        .where(eq(schema.teams.organizationId, organizationId)),
    ]);
    return Response.json({
      teams: teams.map((team) => ({
        id: team.id,
        name: team.name,
        userIds: memberships.filter(({ teamId }) => teamId === team.id).map(({ userId }) => userId),
        createdAt: team.createdAt.toISOString(),
        updatedAt: team.updatedAt?.toISOString() ?? null,
      })),
    });
  }
}

class ManagementResponse extends Error {
  constructor(readonly response: Response) {
    super("management response");
  }
}

function managementSegments(request: Request): string[] {
  const prefix = "/api/management/v1/";
  const path = new URL(request.url).pathname;
  if (!path.startsWith(prefix)) return [];
  try {
    return path.slice(prefix.length).split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return [];
  }
}

async function parseBody<Schema extends z.ZodType>(
  request: Request,
  bodySchema: Schema,
): Promise<z.infer<Schema>> {
  const value = await (request.json() as Promise<unknown>).catch(() => undefined);
  const parsed = bodySchema.safeParse(value);
  if (!parsed.success) throw new ProductRequestError(400, "invalid_request");
  return parsed.data;
}

function serializeAssignments(assignments: Awaited<ReturnType<AccessStore["listAssignments"]>>) {
  return assignments.map(serializeAssignment);
}

function serializeAssignment(assignment: Awaited<ReturnType<AccessStore["saveAssignment"]>>) {
  return {
    ...assignment,
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
  };
}

function serializeIdentity(identity: Awaited<ReturnType<AccessStore["bindChannelIdentity"]>>) {
  return { ...identity, verifiedAt: identity.verifiedAt.toISOString() };
}

function serializeDaemonProject(
  project: Awaited<ReturnType<AccessStore["listDaemonProjects"]>>[number],
) {
  return {
    id: project.id,
    organizationId: project.organizationId,
    daemonId: project.daemonId,
    projectId: project.projectId,
    name: project.name,
    metadata: project.metadata,
    available: project.available,
    observedAt: project.observedAt.toISOString(),
  };
}

function channelConfigurationView(snapshot: Awaited<ReturnType<typeof loadChannelControlPlane>>) {
  const policyFile = snapshot.files.find(({ path }) => path === CHANNEL_POLICY_PATH);
  const policy = OrgPolicySchema.parse(policyFile === undefined ? {} : load(policyFile.content));
  const accounts = snapshot.files
    .filter(({ path }) => path.startsWith(`${CHANNELS_DIRECTORY}/`) && path !== CHANNEL_POLICY_PATH)
    .map((file) => AccountFileSchema.parse(load(file.content)))
    .sort((left, right) =>
      `${left.channel}\0${left.accountId}`.localeCompare(`${right.channel}\0${right.accountId}`),
    );
  return {
    revision:
      snapshot.revision === null
        ? null
        : {
            id: snapshot.revision.id,
            version: snapshot.revision.version,
            createdAt: snapshot.revision.createdAt.toISOString(),
          },
    policy,
    accounts,
    effective: snapshot.controlPlane,
  };
}

function writeChannelConfiguration(
  existing: readonly HubBundleFile[],
  policy: z.infer<typeof OrgPolicySchema>,
  accounts: readonly z.infer<typeof AccountFileSchema>[],
): HubBundleFile[] {
  const paths = new Set<string>();
  const channelFiles: HubBundleFile[] = [
    { path: CHANNEL_POLICY_PATH, content: dump(policy, { lineWidth: -1 }) },
  ];
  for (const account of accounts) {
    if (
      [account.channel, account.accountId].some(
        (value) => value === "." || value === ".." || value.includes("/") || value.includes("\0"),
      )
    ) {
      throw new ProductRequestError(400, "invalid_channel_account_identity");
    }
    const path = `${CHANNELS_DIRECTORY}/${account.channel}/${account.accountId}.yml`;
    if (paths.has(path)) throw new ProductRequestError(400, "duplicate_channel_account");
    paths.add(path);
    channelFiles.push({ path, content: dump(account, { lineWidth: -1 }) });
  }
  return [
    ...existing.filter(({ path }) => !path.startsWith(`${CHANNELS_DIRECTORY}/`)),
    ...channelFiles,
  ];
}

async function automationView(
  store: OrganizationTriggerStore,
  automation: OrganizationTriggerRecord,
) {
  const revision = await store.activeRevision(automation);
  return {
    id: automation.id,
    name: automation.name,
    enabled: automation.enabled,
    format: automation.format,
    activeRevisionId: automation.activeRevisionId,
    definition: load(revision.yaml),
    yaml: revision.yaml,
    createdAt: automation.createdAt.toISOString(),
    updatedAt: automation.updatedAt.toISOString(),
  };
}

function externalIdentityLabel(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  for (const key of ["username", "name", "id"] as const) {
    const candidate = Reflect.get(value, key);
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

function problem(requestId: string, status: number, error: string, message: string): Response {
  return Response.json({ error, message, requestId }, { status });
}
