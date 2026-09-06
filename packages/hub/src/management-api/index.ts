import { editableAutomationYaml } from "../triggers/configuration/workflow-document.js";
import { configuredChannelDestinations } from "../channels/configured-destinations.js";
import { channelTestPreview, CHANNEL_TEST_MESSAGE } from "../channels/test-message.js";
import {
  channelActivityPage,
  channelActivityView,
  parseChannelActivityQuery,
} from "./channel-activity.js";
import { automationRunView } from "./automation-run.js";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { dump, load } from "js-yaml";
import { z } from "zod";
import {
  ACCESS_PRIVILEGES,
  AccessAssignmentBatchInputSchema,
  AccessAssignmentInputSchema,
  RESOURCE_ACCESS_LEVELS,
} from "../access/contract.js";
import {
  assertAutomationConfigurationDelegation,
  assertChannelConfigurationDelegation,
} from "../access/delegation.js";
import { AccessPolicyError, AccessStore } from "../access/store.js";
import { ProductRequestError, type OrganizationAccessValue } from "../auth/organization-access.js";
import type { BrowserOrganizationAccess } from "../auth/browser-organization-access.js";
import { listObservedChannelConversations } from "../channels/conversation-catalog.js";
import type { CompiledChannelAccount } from "../channels/config/compile.js";
import { AccountFileSchema, OrgPolicySchema } from "../channels/config/schema.js";
import {
  assertOpenAudienceAutomationUpdateSafety,
  loadChannelControlPlane,
} from "../channels/control-plane.js";
import {
  ControlPlaneHttpError,
  deployRevision,
  validateChannelConfigurationCandidate,
} from "../channels/http/operations.js";
import type { ChannelSupervisor } from "../channels/supervisor/types.js";
import {
  CHANNELS_DIRECTORY,
  CHANNEL_POLICY_PATH,
  HUB_RESOURCE_PATH,
  type HubBundleFile,
} from "../config/bundle-contract.js";
import { parseCompiledHubConfig } from "../config/compiler.js";
import {
  ChannelConfigurationConflictError,
  OrganizationTriggerConflictError,
} from "../db/errors.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";
import type {
  ChannelConfigurationRevisionRecord,
  Database,
  OrganizationTriggerRecord,
  OrganizationTriggerRevisionRecord,
} from "../db/types.js";
import { reportFailure } from "../failures/index.js";
import { AccessLeaseRevocation } from "../managed-access/revocation.js";
import { AccessTicketError, AccessTicketService } from "../managed-access/tickets.js";
import { OrganizationTeamDirectory } from "../auth/team-directory.js";
import { TriggerDocumentError } from "../triggers/configuration/index.js";
import { OrganizationTriggerStore } from "../triggers/store.js";
import { ManualInvocationInputSchema } from "../triggers/manual/provider.js";
import type { PublicOperations } from "../public-operations/index.js";
import {
  ProviderApplicationError,
  type ProviderApplicationConfiguration,
  type ProviderApplications,
} from "../provider-applications/index.js";
import { providerApplicationSetupGuides } from "./provider-application-setup.js";
import { connectionConsumersById, type ConnectionConsumer } from "./connection-consumers.js";

const ticketRequestSchema = z.object({ clientId: z.string().min(1).max(256) }).strict();
const identityRequestSchema = z
  .object({
    memberId: z.string().min(1),
    connectionId: z.string().min(1),
    externalSubjectId: z.string().min(1),
    displayName: z.string().min(1).nullable().optional(),
  })
  .strict();
const identityChallengeRequestSchema = z.object({ connectionId: z.string().min(1) }).strict();
const channelConfigurationCandidateSchema = z
  .object({
    resource: z.record(z.string(), z.unknown()).optional(),
    policy: OrgPolicySchema,
    accounts: z.array(AccountFileSchema),
  })
  .strict();
const channelConfigurationRequestSchema = channelConfigurationCandidateSchema.extend({
  expectedRevisionId: z.string().uuid().nullable(),
});
const channelAccountTestTargetSchema = z
  .object({
    conversationId: z.string().trim().min(1),
    threadId: z.string().trim().min(1).optional(),
  })
  .strict();
const channelAccountTestRequestSchema = channelAccountTestTargetSchema.extend({
  expectedText: z.string().optional(),
  expectedPreviewId: z.string().optional(),
  expectedRevisionId: z.string().uuid().nullable().optional(),
});
const automationCandidateSchema = z.object({ yaml: z.string().min(1) }).strict();
const automationRequestSchema = automationCandidateSchema.extend({
  expectedRevisionId: z.string().uuid().nullable(),
});
const teamRequestSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
const teamMemberRequestSchema = z.object({ userId: z.string().min(1) }).strict();
const providerApplicationRequestSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("github"),
      appId: z.string().trim().min(1),
      appSlug: z.string().trim().min(1),
      clientId: z.string().trim().min(1),
      clientSecret: z.string().min(1),
      privateKey: z.string().min(1),
      webhookSecret: z.string().min(1).optional(),
      expectedVersion: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("slack"),
      transport: z.literal("webhook"),
      appId: z.string().trim().min(1),
      clientId: z.string().trim().min(1),
      clientSecret: z.string().min(1),
      signingSecret: z.string().min(1),
      expectedVersion: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("discord"),
      applicationId: z.string().trim().min(1),
      clientSecret: z.string().min(1),
      botToken: z.string().min(1),
      expectedVersion: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("linear"),
      clientId: z.string().trim().min(1),
      clientSecret: z.string().min(1),
      webhookSecret: z.string().min(1),
      expectedVersion: z.number().int().positive().optional(),
    })
    .strict(),
]);
const connectionRequestSchema = z.union([
  z
    .object({
      provider: z.literal("telegram"),
      accountId: z.string().trim().min(1).max(128),
      credentials: z.object({ botToken: z.string().trim().min(1) }).strict(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("slack"),
      transport: z.literal("socket"),
      credentials: z
        .object({
          appToken: z.string().trim().startsWith("xapp-").min(6),
          botToken: z.string().trim().startsWith("xoxb-").min(6),
        })
        .strict(),
      expectedVersion: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      provider: z.enum(["github", "slack", "discord", "linear"]),
      providerApplicationId: z.string().trim().min(1),
    })
    .strict(),
]);

function providerApplicationConfiguration(
  input: z.infer<typeof providerApplicationRequestSchema>,
): ProviderApplicationConfiguration {
  switch (input.provider) {
    case "github":
      return {
        provider: input.provider,
        appId: input.appId,
        appSlug: input.appSlug,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        privateKey: input.privateKey,
        ...(input.webhookSecret === undefined ? {} : { webhookSecret: input.webhookSecret }),
        ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
      };
    case "slack":
      return {
        provider: input.provider,
        transport: input.transport,
        appId: input.appId,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        signingSecret: input.signingSecret,
        ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
      };
    case "discord":
      return {
        provider: input.provider,
        applicationId: input.applicationId,
        clientSecret: input.clientSecret,
        botToken: input.botToken,
        ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
      };
    case "linear":
      return {
        provider: input.provider,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        webhookSecret: input.webhookSecret,
        ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
      };
  }
  throw new Error("unsupported Provider Application");
}

type ManagementConnectionProvider = "github" | "slack" | "discord" | "linear" | "telegram";

interface ManagementConnectionView {
  id: string;
  provider: ManagementConnectionProvider;
  providerApplicationId: string | null;
  name: string;
  externalName: string | null;
  status: string;
  consumers: readonly ConnectionConsumer[];
}

type ManagementConnectionSummary = Omit<ManagementConnectionView, "consumers">;

/** Browser/app management contract; each operation delegates to an existing Hub domain owner. */
export class ManagementApi {
  private readonly accessLeaseRevocation: AccessLeaseRevocation;
  private readonly teams: OrganizationTeamDirectory;

  constructor(
    private readonly options: {
      database: Database;
      runtime: DatabaseRuntime;
      auth: BrowserOrganizationAccess;
      access: AccessStore;
      tickets: AccessTicketService;
      channelSupervisor: ChannelSupervisor | null;
      providerApplications?: ProviderApplications | null;
      disconnectProviderConnection?: (
        request: Request,
        input: {
          provider: "github" | "slack" | "discord" | "linear";
          connectionId: string;
          organizationSlug: string;
        },
      ) => Promise<Response>;
      accessLeaseRevocation?: AccessLeaseRevocation;
      manualRuns?: Pick<PublicOperations, "dispatchManualRun"> | null;
      revokeDaemon?: (request: Request, daemonId: string) => Promise<Response>;
      renameDaemon?: (request: Request, daemonId: string) => Promise<Response>;
    },
  ) {
    this.accessLeaseRevocation =
      options.accessLeaseRevocation ?? new AccessLeaseRevocation(options.tickets);
    this.teams = new OrganizationTeamDirectory(options.runtime);
  }

  async handle(request: Request): Promise<Response> {
    const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
    try {
      return await this.dispatch(request, requestId);
    } catch (error) {
      if (error instanceof ManagementResponse) return error.response;
      if (error instanceof ProductRequestError) return error.response();
      if (error instanceof AccessPolicyError) {
        let status = 404;
        if (error.code === "access_denied") status = 403;
        else if (error.code === "invalid_assignment") status = 400;
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
      if (error instanceof ProviderApplicationError) {
        return providerApplicationProblem(requestId, error);
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
      this.requireHubAction(access, "hub.access.manage");
      return Response.json({
        privileges: ACCESS_PRIVILEGES,
        accessLevels: RESOURCE_ACCESS_LEVELS,
        resources: await this.options.access.listResources(organizationId),
      });
    }
    if (method === "GET" && segments.length === 3 && resource === "members") {
      return this.listMembers(organizationId);
    }
    if (resource === "teams") {
      return this.handleTeams(request, requestId, access, segments);
    }
    if (resource === "provider-applications") {
      return this.handleProviderApplications(request, requestId, access, segments);
    }
    if (resource === "connections") {
      return this.handleConnections(request, requestId, access, segments);
    }
    if (resource === "channel-configuration") {
      return this.handleChannelConfiguration(request, requestId, access, segments);
    }
    if (resource === "channel-activity") {
      return this.handleChannelActivity(request, requestId, access, segments);
    }
    if (resource === "channel-accounts") {
      return this.handleChannelAccounts(request, requestId, access, segments);
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

  private async handleTeams(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
  ): Promise<Response> {
    if (request.method === "GET" && segments.length === 3) {
      return this.listTeams(access.organization.id);
    }
    this.requireHubAction(access, "hub.access.manage");
    this.requireMutation(request);
    if (request.method === "POST" && segments.length === 3) {
      return this.createTeam(request, access.organization.id);
    }
    const teamId = segments[3];
    if (teamId === undefined) {
      return problem(requestId, 404, "not_found", "No management resource matches this path.");
    }
    if (request.method === "PUT" && segments.length === 4) {
      return this.renameTeam(request, requestId, access.organization.id, teamId);
    }
    if (request.method === "DELETE" && segments.length === 4) {
      return this.removeTeam(requestId, access.organization.id, teamId);
    }
    if (segments[4] === "members" && segments.length === 5 && request.method === "POST") {
      return this.addTeamMember(request, requestId, access.organization.id, teamId);
    }
    const userId = segments[5];
    if (
      segments[4] === "members" &&
      userId !== undefined &&
      segments.length === 6 &&
      request.method === "DELETE"
    ) {
      return this.removeTeamMember(requestId, access.organization.id, teamId, userId);
    }
    return problem(requestId, 404, "not_found", "No management resource matches this path.");
  }

  private async createTeam(request: Request, organizationId: string): Promise<Response> {
    const input = await parseBody(request, teamRequestSchema);
    const team = await this.teams.create(organizationId, input.name);
    await this.revokeOrganizationAccessLeases(organizationId);
    return Response.json(serializeTeam(team, []), { status: 201 });
  }

  private async renameTeam(
    request: Request,
    requestId: string,
    organizationId: string,
    teamId: string,
  ): Promise<Response> {
    const input = await parseBody(request, teamRequestSchema);
    const team = await this.teams.rename(organizationId, teamId, input.name);
    if (team === undefined) {
      return problem(requestId, 404, "team_unavailable", "Team is unavailable.");
    }
    await this.revokeOrganizationAccessLeases(organizationId);
    const current = await this.listTeamUserIds(organizationId, teamId);
    return Response.json(serializeTeam(team, current));
  }

  private async removeTeam(
    requestId: string,
    organizationId: string,
    teamId: string,
  ): Promise<Response> {
    const deleted = await this.teams.remove(organizationId, teamId);
    if (!deleted) {
      return problem(requestId, 404, "team_unavailable", "Team is unavailable.");
    }
    await this.revokeOrganizationAccessLeases(organizationId);
    return new Response(null, { status: 204 });
  }

  private async addTeamMember(
    request: Request,
    requestId: string,
    organizationId: string,
    teamId: string,
  ): Promise<Response> {
    const input = await parseBody(request, teamMemberRequestSchema);
    const membership = await this.teams.addMember(organizationId, teamId, input.userId);
    if (membership === undefined) {
      return problem(
        requestId,
        404,
        "team_or_member_unavailable",
        "Team or Member is unavailable.",
      );
    }
    await this.revokeOrganizationAccessLeases(organizationId);
    return Response.json(
      {
        id: membership.id,
        teamId: membership.teamId,
        userId: membership.userId,
        createdAt: membership.createdAt.toISOString(),
      },
      { status: 201 },
    );
  }

  private async removeTeamMember(
    requestId: string,
    organizationId: string,
    teamId: string,
    userId: string,
  ): Promise<Response> {
    const removed = await this.teams.removeMember(organizationId, teamId, userId);
    if (!removed) {
      return problem(
        requestId,
        404,
        "team_membership_unavailable",
        "Team membership is unavailable.",
      );
    }
    await this.revokeOrganizationAccessLeases(organizationId);
    return new Response(null, { status: 204 });
  }

  private async handleAccessAssignments(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
  ): Promise<Response> {
    if (request.method === "GET" && segments.length === 4 && segments[3] === "effective") {
      const effective = await this.options.access.listEffectiveAccess({
        organizationId: access.organization.id,
        userId: access.account.id,
        membershipId: access.membership.id,
      });
      return effective === undefined
        ? problem(
            requestId,
            404,
            "membership_unavailable",
            "Organization membership is unavailable.",
          )
        : Response.json(effective);
    }
    this.requireHubAction(access, "hub.access.manage");
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
      await this.revokeOrganizationAccessLeases(access.organization.id);
      return Response.json(serializeAssignment(assignment), { status: 201 });
    }
    if (request.method === "POST" && segments.length === 4 && segments[3] === "batch") {
      this.requireMutation(request);
      const input = await parseBody(request, AccessAssignmentBatchInputSchema);
      const assignments = await this.options.access.saveAssignments(
        access.organization.id,
        input.assignments,
        access.account.id,
      );
      await this.revokeOrganizationAccessLeases(access.organization.id);
      return Response.json({ assignments: serializeAssignments(assignments) }, { status: 201 });
    }
    if (request.method === "DELETE" && segments.length === 4) {
      this.requireMutation(request);
      const deleted = await this.options.access.deleteAssignment(
        access.organization.id,
        segments[3]!,
      );
      if (deleted) await this.revokeOrganizationAccessLeases(access.organization.id);
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

  private async revokeOrganizationAccessLeases(organizationId: string): Promise<void> {
    await this.accessLeaseRevocation.revokeOrganization(organizationId);
  }

  private async handleProviderApplications(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
  ): Promise<Response> {
    if (segments.length !== 3 && segments.length !== 7) {
      return problem(requestId, 404, "not_found", "No management resource matches this path.");
    }
    this.requireHubAction(access, "hub.configure");
    const applications = this.options.providerApplications;
    if (applications === null || applications === undefined) {
      return problem(
        requestId,
        503,
        "provider_applications_unavailable",
        "Provider Applications are unavailable.",
      );
    }
    if (
      request.method === "POST" &&
      segments.length === 7 &&
      segments[3] === "slack" &&
      segments[5] === "delivery" &&
      segments[6] === "retry"
    ) {
      this.requireMutation(request);
      await applications.retrySlackSocket(request, segments[4]!);
      return Response.json({ status: "retrying" });
    }
    if (segments.length !== 3) {
      return problem(requestId, 404, "not_found", "No management resource matches this path.");
    }
    if (request.method === "GET") {
      const overview = await applications.overview(request);
      return Response.json({
        ...overview,
        setupGuides: providerApplicationSetupGuides(overview.callbackOrigin),
      });
    }
    if (request.method !== "POST") {
      return problem(
        requestId,
        405,
        "method_not_allowed",
        "Use GET or POST for Provider Applications.",
      );
    }
    this.requireMutation(request);
    const input = await parseBody(request, providerApplicationRequestSchema);
    const result = await applications.verifyAndSave(
      request,
      input.provider,
      providerApplicationConfiguration(input),
      "paseo",
    );
    return Response.json(result, {
      status: result.status === "continuing" ? 202 : 201,
    });
  }

  private async handleConnections(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
  ): Promise<Response> {
    if (segments.length !== 3 && segments.length !== 4) {
      return problem(requestId, 404, "not_found", "No management resource matches this path.");
    }
    if (request.method === "DELETE" && segments.length === 4) {
      this.requireHubAction(access, "hub.configure");
      this.requireMutation(request);
      return this.disconnectConnection(request, requestId, access, segments[3]!);
    }
    if (segments.length !== 3) {
      return problem(requestId, 404, "not_found", "No management resource matches this path.");
    }
    if (request.method === "POST") {
      this.requireHubAction(access, "hub.configure");
      this.requireMutation(request);
      const input = await parseBody(request, connectionRequestSchema);
      if (input.provider === "telegram") {
        const { connectionId } = await this.options.database.configureTelegramConnection({
          organizationId: access.organization.id,
          accountId: input.accountId,
          botToken: input.credentials.botToken,
        });
        await this.restartChannelAccountsUsingConnection(access.organization.id, connectionId);
        return Response.json(
          {
            id: connectionId,
            provider: "telegram",
            providerApplicationId: null,
            name: input.accountId,
            externalName: null,
            status: "active",
            consumers: [],
          },
          { status: 201 },
        );
      }
      if ("providerApplicationId" in input) {
        const applications = this.options.providerApplications;
        if (applications === null || applications === undefined) {
          return problem(
            requestId,
            503,
            "provider_applications_unavailable",
            "Provider Applications are unavailable.",
          );
        }
        const continuation = await applications.beginConnection(
          request,
          input.provider,
          input.providerApplicationId,
          access.organization.id,
          "paseo",
        );
        return Response.json(
          {
            status: "continuing",
            provider: input.provider,
            url: continuation.url,
          },
          { status: 202 },
        );
      }
      if (
        this.options.providerApplications === null ||
        this.options.providerApplications === undefined
      ) {
        return problem(
          requestId,
          503,
          "provider_applications_unavailable",
          "Provider Applications are unavailable.",
        );
      }
      const result = await this.options.providerApplications.configureSlackSocket(request, {
        appToken: input.credentials.appToken,
        botToken: input.credentials.botToken,
        ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
      });
      const configuredConnection = (
        await this.options.database.organizationConnectionUsage(access.organization.id)
      ).slack.find(
        (candidate) =>
          candidate.providerApplicationId === result.identity.id &&
          candidate.botAccessToken === input.credentials.botToken,
      );
      const connections = await this.connectionViews(access.organization.id);
      const connection = connections.find((candidate) => candidate.id === configuredConnection?.id);
      if (connection === undefined) {
        return problem(
          requestId,
          503,
          "connection_unavailable",
          "The provider account was verified but its Connection is unavailable.",
        );
      }
      return Response.json(connection, { status: 201 });
    }
    if (request.method !== "GET") {
      return problem(requestId, 405, "method_not_allowed", "Use GET or POST for Connections.");
    }
    const connections = await this.connectionViews(access.organization.id);
    const linkableConnectionIds = await this.options.access.linkableChannelConnectionIds({
      organizationId: access.organization.id,
      userId: access.account.id,
      membershipId: access.membership.id,
      connectionIds: connections.map(({ id }) => id),
    });
    const connectionAccess = connections.map((connection) =>
      Object.assign({}, connection, {
        canLinkIdentity: linkableConnectionIds.has(connection.id),
      }),
    );
    if (!access.capabilities.manageResources) {
      return Response.json({
        connections: connectionAccess.filter(({ canLinkIdentity }) => canLinkIdentity),
        providerApplications: [],
      });
    }
    const providerApplications =
      this.options.providerApplications === null || this.options.providerApplications === undefined
        ? []
        : await this.options.providerApplications.connectionCatalog(request);
    return Response.json({
      connections: connectionAccess,
      providerApplications,
    });
  }

  private async connectionViews(
    organizationId: string,
  ): Promise<readonly ManagementConnectionView[]> {
    const usage = await this.options.database.organizationConnectionUsage(organizationId);
    const telegram = await this.options.runtime
      .drizzle()
      .select({
        id: schema.telegramConnections.id,
        name: schema.telegramConnections.accountId,
        identity: schema.telegramConnections.externalIdentity,
      })
      .from(schema.telegramConnections)
      .where(eq(schema.telegramConnections.organizationId, organizationId))
      .orderBy(asc(schema.telegramConnections.accountId));
    const connections: ManagementConnectionSummary[] = [
      ...usage.github.map(
        (connection): ManagementConnectionSummary => ({
          id: connection.id,
          provider: "github",
          providerApplicationId: connection.providerApplicationId,
          name: connection.slug,
          externalName: connection.accountLogin,
          status: connection.status,
        }),
      ),
      ...usage.discord.map(
        (connection): ManagementConnectionSummary => ({
          id: connection.id,
          provider: "discord",
          providerApplicationId: connection.providerApplicationId,
          name: connection.slug,
          externalName: connection.guildName,
          status: "active",
        }),
      ),
      ...usage.slack.map(
        (connection): ManagementConnectionSummary => ({
          id: connection.id,
          provider: "slack",
          providerApplicationId: connection.providerApplicationId,
          name: connection.slug,
          externalName: connection.teamName,
          status: "active",
        }),
      ),
      ...usage.linear.map(
        (connection): ManagementConnectionSummary => ({
          id: connection.id,
          provider: "linear",
          providerApplicationId: connection.providerApplicationId,
          name: connection.slug,
          externalName: connection.linearOrganizationName,
          status: "active",
        }),
      ),
      ...telegram.map(
        (connection): ManagementConnectionSummary => ({
          id: connection.id,
          provider: "telegram",
          providerApplicationId: null,
          name: connection.name,
          externalName: externalIdentityLabel(connection.identity),
          status: "active",
        }),
      ),
    ];
    const consumers = await connectionConsumersById({
      database: this.options.database,
      runtime: this.options.runtime,
      organizationId,
    });
    return connections.map((connection) =>
      Object.assign({}, connection, {
        consumers: consumers.get(connection.id) ?? [],
      }),
    );
  }

  /** Reloads credentials held by every enabled Channel account using this Connection. */
  private async restartChannelAccountsUsingConnection(
    organizationId: string,
    connectionId: string,
  ): Promise<void> {
    const supervisor = this.options.channelSupervisor;
    if (supervisor === null) return;
    const snapshot = await loadChannelControlPlane(this.options.database, organizationId);
    if (!snapshot.controlPlane.enabled) return;
    for (const account of snapshot.controlPlane.accounts) {
      if (account.connectionId !== connectionId || !account.enabled || !account.channelEnabled) {
        continue;
      }
      await supervisor.startAccount(account.channel, account.accountId);
    }
  }

  private async disconnectConnection(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    connectionId: string,
  ): Promise<Response> {
    const connection = (await this.connectionViews(access.organization.id)).find(
      (candidate) => candidate.id === connectionId,
    );
    if (connection === undefined) {
      return problem(requestId, 404, "connection_unavailable", "Connection is unavailable.");
    }
    if (connection.consumers.length > 0) {
      return connectionInUseProblem(requestId, connection.consumers);
    }
    if (connection.provider === "telegram") {
      await this.options.runtime.transaction(async (transaction) => {
        await transaction
          .drizzle()
          .delete(schema.channelIdentities)
          .where(
            and(
              eq(schema.channelIdentities.organizationId, access.organization.id),
              eq(schema.channelIdentities.connectionId, connectionId),
            ),
          );
        await transaction
          .drizzle()
          .delete(schema.telegramConnections)
          .where(
            and(
              eq(schema.telegramConnections.organizationId, access.organization.id),
              eq(schema.telegramConnections.id, connectionId),
            ),
          );
      });
    } else {
      const disconnect = this.options.disconnectProviderConnection;
      if (disconnect === undefined) {
        return problem(
          requestId,
          503,
          "connection_lifecycle_unavailable",
          "Connection lifecycle is unavailable.",
        );
      }
      if (access.organization.slug === undefined) {
        return problem(
          requestId,
          409,
          "organization_unavailable",
          "The organization needs a URL slug before this Connection can be disconnected.",
        );
      }
      const response = await disconnect(request, {
        provider: connection.provider,
        connectionId,
        organizationSlug: access.organization.slug,
      });
      if (!response.ok) return response;
      await this.options.runtime
        .drizzle()
        .delete(schema.channelIdentities)
        .where(
          and(
            eq(schema.channelIdentities.organizationId, access.organization.id),
            eq(schema.channelIdentities.connectionId, connectionId),
          ),
        );
    }
    await this.revokeOrganizationAccessLeases(access.organization.id);
    return new Response(null, { status: 204 });
  }

  private async handleChannelConfiguration(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
  ): Promise<Response> {
    const isValidation =
      request.method === "POST" && segments.length === 4 && segments[3] === "validate";
    const isRevisionList =
      request.method === "GET" && segments.length === 4 && segments[3] === "revisions";
    if (segments.length !== 3 && !isValidation && !isRevisionList) {
      return problem(requestId, 404, "not_found", "No management resource matches this path.");
    }
    this.requireHubAction(access, "channel.manage");
    if (isRevisionList) {
      const revisions = await this.options.database.listChannelConfigurationRevisions(
        access.organization.id,
        50,
      );
      return Response.json({
        revisions: revisions.map((revision) => channelRevisionSummary(revision)),
      });
    }
    const snapshot = await loadChannelControlPlane(this.options.database, access.organization.id);
    if (request.method === "GET") {
      return Response.json(channelConfigurationView(snapshot));
    }
    if (request.method !== "PUT" && !isValidation) {
      return problem(
        requestId,
        405,
        "method_not_allowed",
        "Use GET, PUT, or POST to the validate resource for Channel configuration.",
      );
    }
    if (!isValidation) this.requireMutation(request);
    const input = await parseBody(
      request,
      isValidation ? channelConfigurationCandidateSchema : channelConfigurationRequestSchema,
    );
    const connections = await this.connectionViews(access.organization.id);
    for (const account of input.accounts) {
      const connection = connections.find((candidate) => candidate.id === account.connectionId);
      if (connection === undefined || connection.provider !== account.channel) {
        return problem(
          requestId,
          422,
          "invalid_connection_reference",
          `${account.channel} account ${account.accountId} must use an available ${account.channel} Connection.`,
        );
      }
    }
    const files = writeChannelConfiguration(
      snapshot.files,
      input.policy,
      input.accounts,
      input.resource,
    );
    if (isValidation) {
      const effective = await validateChannelConfigurationCandidate(
        this.options.database,
        snapshot,
        files,
      );
      return Response.json({ valid: true, effective });
    }
    const expectedRevisionId = channelConfigurationRequestSchema.parse(input).expectedRevisionId;
    await deployRevision(this.options.database, snapshot, files, {
      createdByUserId: access.account.id,
      expectedRevisionId,
      authorize: ({ bundle, controlPlane }) =>
        assertChannelConfigurationDelegation({
          access: this.options.access,
          database: this.options.database,
          principal: delegationPrincipal(access),
          bundle,
          controlPlane,
        }),
    });
    const reconciliation = await this.options.channelSupervisor?.reconcile();
    const active = await loadChannelControlPlane(this.options.database, access.organization.id);
    return Response.json({
      ...channelConfigurationView(active),
      reconciliation: reconciliation ?? null,
    });
  }

  private async handleChannelActivity(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
  ): Promise<Response> {
    this.requireHubAction(access, "channel.manage");
    if (request.method !== "GET" || segments.length !== 3) {
      return problem(requestId, 404, "not_found", "No management resource matches this path.");
    }
    return Response.json(
      await channelActivityPage(
        this.options.runtime,
        access.organization.id,
        parseChannelActivityQuery(new URL(request.url).searchParams),
      ),
    );
  }

  private async handleChannelAccounts(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
  ): Promise<Response> {
    if (request.method === "GET" && segments.length === 4 && segments[3] === "status") {
      return this.channelAccountStatus(access);
    }
    const operation = channelAccountOperation(request, segments);
    if (operation === undefined || segments[3] === undefined || segments[4] === undefined) {
      return problem(requestId, 404, "not_found", "No management resource matches this path.");
    }
    this.requireHubAction(access, "channel.manage");
    if (request.method !== "GET") this.requireMutation(request);
    const channel = z.enum(["slack", "telegram"]).safeParse(segments[3]);
    if (!channel.success) {
      return problem(
        requestId,
        404,
        "channel_account_unavailable",
        "Channel account is unavailable.",
      );
    }
    const accountId = segments[4];
    const snapshot = await loadChannelControlPlane(this.options.database, access.organization.id);
    const account = snapshot.controlPlane.accounts.find(
      (candidate) => candidate.channel === channel.data && candidate.accountId === accountId,
    );
    if (account === undefined || (request.method !== "GET" && !account.enabled)) {
      return problem(
        requestId,
        404,
        "channel_account_unavailable",
        "Channel account is unavailable.",
      );
    }
    if (operation === "activity") {
      return Response.json(
        await channelActivityView(
          this.options.runtime,
          access.organization.id,
          channel.data,
          accountId,
        ),
      );
    }
    if (operation === "conversations") {
      return this.listChannelAccountConversations(access, channel.data, accountId, account);
    }
    if (operation === "test-preview") {
      return this.previewChannelAccountTest(
        request,
        access,
        channel.data,
        accountId,
        account,
        snapshot.revision?.id ?? null,
      );
    }
    if (operation === "retry") {
      return this.retryChannelAccount(requestId, channel.data, accountId);
    }
    return this.testChannelAccount(
      request,
      requestId,
      channel.data,
      accountId,
      account,
      snapshot.revision?.id ?? null,
    );
  }

  private async previewChannelAccountTest(
    request: Request,
    access: OrganizationAccessValue,
    channel: "slack" | "telegram",
    accountId: string,
    account: CompiledChannelAccount,
    revisionId: string | null,
  ): Promise<Response> {
    const parsed = channelAccountTestTargetSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) throw new ProductRequestError(400, "invalid_request");
    if (!configuredChannelTestTarget(account, parsed.data))
      throw new ProductRequestError(422, "conversation_not_configured");
    const metadataAllowed = await this.configuredMetadataRoot(
      access.organization.id,
      channel,
      account,
      parsed.data,
    );
    const metadata = metadataAllowed
      ? await this.options.channelSupervisor?.resolveConversation?.({
          organizationId: access.organization.id,
          channel,
          accountId,
          connectionId: account.connectionId,
          conversationId: parsed.data.conversationId,
        })
      : null;
    return Response.json({
      ...channelTestPreview({
        channel,
        accountId,
        ...parsed.data,
        revisionId,
        connectionId: account.connectionId,
      }),
      label: metadata?.label ?? null,
      threadLabel: null,
    });
  }

  private async configuredMetadataRoot(
    organizationId: string,
    channel: "slack" | "telegram",
    account: CompiledChannelAccount,
    input: { conversationId: string; threadId?: string | undefined },
  ): Promise<boolean> {
    if (
      account.routes.some(
        ({ match }) =>
          match.kind !== "thread" &&
          match.kind !== "topic" &&
          match.ids.includes(input.conversationId),
      )
    )
      return true;
    const nested = account.routes.filter(
      ({ match }) =>
        (match.kind === "thread" || match.kind === "topic") &&
        input.threadId !== undefined &&
        match.ids.includes(input.threadId),
    );
    if (nested.length === 0) return false;
    const observed = await listObservedChannelConversations(this.options.runtime, {
      organizationId,
      channel,
      accountId: account.accountId,
    });
    return observed.some(
      (item) =>
        item.rootConversationId === input.conversationId &&
        item.threadId === input.threadId &&
        nested.some(({ match }) => match.kind === item.kind),
    );
  }

  private async channelAccountStatus(access: OrganizationAccessValue): Promise<Response> {
    this.requireHubAction(access, "channel.manage");
    const snapshot = await loadChannelControlPlane(this.options.database, access.organization.id);
    const configured = new Set(
      snapshot.controlPlane.accounts.map(({ channel, accountId }) => `${channel}\0${accountId}`),
    );
    return Response.json({
      runtimeAvailable: this.options.channelSupervisor !== null,
      accounts:
        this.options.channelSupervisor
          ?.status()
          .filter(({ channel, account }) => configured.has(`${channel}\0${account}`)) ?? [],
    });
  }

  private async listChannelAccountConversations(
    access: OrganizationAccessValue,
    channel: "slack" | "telegram",
    accountId: string,
    account: CompiledChannelAccount,
  ): Promise<Response> {
    const conversations = await listObservedChannelConversations(this.options.runtime, {
      organizationId: access.organization.id,
      channel,
      accountId,
    });
    const destinations = await configuredChannelDestinations(
      account,
      conversations,
      (conversationId, budget) =>
        this.options.channelSupervisor?.resolveConversation?.({
          organizationId: access.organization.id,
          channel,
          accountId,
          connectionId: account.connectionId,
          conversationId,
          budget,
        }) ?? Promise.resolve(null),
    );
    return Response.json({
      destinations,
      conversations: conversations.map((conversation) =>
        Object.assign({}, conversation, {
          observedAt: conversation.observedAt.toISOString(),
        }),
      ),
    });
  }

  private async retryChannelAccount(
    requestId: string,
    channel: "slack" | "telegram",
    accountId: string,
  ): Promise<Response> {
    if (this.options.channelSupervisor === null) {
      return problem(
        requestId,
        503,
        "channel_runtime_unavailable",
        "Channel runtime is unavailable.",
      );
    }
    const result = await this.options.channelSupervisor.startAccount(channel, accountId);
    const status = this.options.channelSupervisor
      .status()
      .find((entry) => entry.channel === channel && entry.account === accountId);
    return Response.json({ result, status: status ?? null });
  }

  private async testChannelAccount(
    request: Request,
    requestId: string,
    channel: "slack" | "telegram",
    accountId: string,
    account: CompiledChannelAccount,
    revisionId: string | null,
  ): Promise<Response> {
    const input = await parseBody(request, channelAccountTestRequestSchema);
    const preview = channelTestPreview({
      channel,
      accountId,
      ...input,
      revisionId,
      connectionId: account.connectionId,
    });
    if (input.expectedPreviewId !== undefined && input.expectedPreviewId !== preview.previewId) {
      throw new ProductRequestError(409, "channel_test_preview_changed");
    }
    if (
      (input.expectedText !== undefined && input.expectedText !== CHANNEL_TEST_MESSAGE) ||
      (input.expectedRevisionId !== undefined && input.expectedRevisionId !== revisionId)
    ) {
      throw new ProductRequestError(409, "channel_test_preview_changed");
    }
    const authorizedTarget = configuredChannelTestTarget(account, input);
    if (!authorizedTarget) {
      return problem(
        requestId,
        422,
        "conversation_not_configured",
        "Choose an explicit Conversation ID already configured on this Channel account.",
      );
    }
    if (this.options.channelSupervisor === null) {
      return problem(
        requestId,
        503,
        "channel_runtime_unavailable",
        "Channel runtime is unavailable.",
      );
    }
    const result = await this.options.channelSupervisor.postTestMessage({
      channel,
      accountId,
      conversationId: input.conversationId,
      ...(input.expectedPreviewId !== undefined || input.expectedRevisionId !== undefined
        ? { expectedRevisionId: revisionId }
        : {}),
      ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
    });
    if (!result.ok) {
      return problem(
        requestId,
        409,
        "channel_test_failed",
        result.error ?? "The Channel test message could not be sent.",
      );
    }
    return Response.json({
      ok: true,
      externalMessageId: result.externalMessageId ?? null,
    });
  }

  private async handleAutomations(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
  ): Promise<Response> {
    const store = new OrganizationTriggerStore(this.options.database, access.organization.id);
    const isRunnableList =
      request.method === "GET" && segments.length === 4 && segments[3] === "runnable";
    const isValidation =
      request.method === "POST" && segments.length === 4 && segments[3] === "validate";
    const isRun = request.method === "POST" && segments.length === 5 && segments[4] === "runs";
    if (isRunnableList) {
      return this.listRunnableAutomations(requestId, access, store);
    }
    if (isRun) {
      return this.runAutomation(request, requestId, access, segments[3], store);
    }
    this.requireHubAction(access, "hub.configure");
    if (request.method === "GET") {
      return this.readAutomations(requestId, access, segments, store);
    }
    if (!["POST", "PUT"].includes(request.method)) {
      return problem(
        requestId,
        405,
        "method_not_allowed",
        "Use GET, POST, PUT, or POST to the validate resource for Automations.",
      );
    }
    if (isValidation) {
      return validateAutomation(request, store);
    }
    this.requireMutation(request);
    const isCreate = request.method === "POST" && segments.length === 3;
    const isUpdate = request.method === "PUT" && segments.length === 4;
    if (!isCreate && !isUpdate) {
      return problem(requestId, 404, "not_found", "No management resource matches this path.");
    }
    return this.saveAutomation(request, access, segments[3], isUpdate, store);
  }

  private async listRunnableAutomations(
    requestId: string,
    access: OrganizationAccessValue,
    store: OrganizationTriggerStore,
  ): Promise<Response> {
    const effective = await this.options.access.listEffectiveAccess({
      organizationId: access.organization.id,
      userId: access.account.id,
      membershipId: access.membership.id,
    });
    if (effective === undefined) {
      return problem(requestId, 404, "membership_unavailable", "Membership is unavailable.");
    }
    const runnableIds = new Set(
      effective.grants.flatMap(({ resource, privileges }) =>
        resource.kind === "automation" &&
        resource.available &&
        privileges.includes("automation.run")
          ? [resource.id]
          : [],
      ),
    );
    const projections = await Promise.all(
      (await store.list())
        .filter(({ id, enabled }) => enabled && (effective.owner || runnableIds.has(id)))
        .map(async (automation) =>
          runnableAutomationView(await store.activeRevision(automation), automation),
        ),
    );
    return Response.json({ automations: projections.filter(isPresent) });
  }

  private async runAutomation(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    automationId: string | undefined,
    store: OrganizationTriggerStore,
  ): Promise<Response> {
    this.requireMutation(request);
    const automation = (await store.list()).find(({ id }) => id === automationId);
    if (automation === undefined || !(await this.canRunAutomation(access, automation.id))) {
      return problem(requestId, 404, "automation_unavailable", "Automation is unavailable.");
    }
    if (this.options.manualRuns === null || this.options.manualRuns === undefined) {
      return problem(
        requestId,
        503,
        "automation_runtime_unavailable",
        "Automation runtime is unavailable.",
      );
    }
    const input = await parseBody(request, ManualInvocationInputSchema);
    const result = await this.options.manualRuns.dispatchManualRun(
      {
        kind: "member",
        membershipId: access.membership.id,
        organizationId: access.organization.id,
      },
      {
        expectedVersionId: automation.activeRevisionId,
        trigger: automation.name,
        actor: access.account.id,
        deliveryKey: randomUUID(),
        input,
      },
    );
    return Response.json(result);
  }

  private async readAutomations(
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
    store: OrganizationTriggerStore,
  ): Promise<Response> {
    if (segments.length === 3) {
      const automations = await Promise.all(
        (await store.list()).map((automation) => automationView(store, automation)),
      );
      return Response.json({ automations });
    }
    const automation = (await store.list()).find(({ id }) => id === segments[3]);
    if (automation === undefined) {
      return problem(requestId, 404, "automation_unavailable", "Automation is unavailable.");
    }
    if (segments.length === 4) return Response.json(await automationView(store, automation));
    if (segments.length === 5 && segments[4] === "revisions") {
      const revisions = await this.options.database.listOrganizationTriggerRevisions(
        access.organization.id,
        automation.id,
        50,
      );
      return Response.json({
        revisions: revisions.map((revision) => automationRevisionView(revision)),
      });
    }
    if (segments.length === 6 && segments[4] === "runs") {
      const runId = segments[5];
      if (runId === undefined || !z.string().uuid().safeParse(runId).success) {
        return problem(requestId, 404, "run_unavailable", "Run is unavailable.");
      }
      const run = await automationRunView(
        this.options.database,
        access.organization.id,
        automation.id,
        runId,
      );
      return run === undefined
        ? problem(requestId, 404, "run_unavailable", "Run is unavailable.")
        : Response.json(run);
    }
    if (segments.length === 5 && segments[4] === "activity") {
      const activity = await this.options.database.listWorkflowActivityRuns(automation.id, 100);
      return Response.json({
        activity: activity.map(({ run, receipt }) => ({
          id: run.id,
          outcome: run.outcome,
          status: run.status,
          revisionId: run.configurationRevisionId,
          provider: receipt.provider,
          source: receipt.source,
          createdAt: run.createdAt.toISOString(),
          completedAt: run.completedAt?.toISOString() ?? null,
          error: run.outcome === "accepted" ? run.failureReason : run.rejection.code,
        })),
      });
    }
    return problem(requestId, 404, "not_found", "No management resource matches this path.");
  }

  private async saveAutomation(
    request: Request,
    access: OrganizationAccessValue,
    automationId: string | undefined,
    isUpdate: boolean,
    store: OrganizationTriggerStore,
  ): Promise<Response> {
    const input = await parseBody(request, automationRequestSchema);
    const automation = await store.save(
      {
        ...(automationId === undefined ? {} : { triggerId: automationId }),
        yaml: input.yaml,
        userId: access.account.id,
        expectedActiveRevisionId: input.expectedRevisionId,
      },
      {
        authorize: async ({ compiled, resolved }) => {
          await assertAutomationConfigurationDelegation({
            access: this.options.access,
            principal: delegationPrincipal(access),
            configuration: resolved.configuration,
          });
          if (isUpdate && automationId !== undefined) {
            await assertOpenAudienceAutomationUpdateSafety({
              database: this.options.database,
              organizationId: access.organization.id,
              automationId,
              candidate: compiled,
            });
          }
        },
      },
    );
    await this.options.channelSupervisor?.reconcile();
    return Response.json(await automationView(store, automation), {
      status: isUpdate ? 200 : 201,
    });
  }

  private async canRunAutomation(
    access: OrganizationAccessValue,
    automationId: string,
  ): Promise<boolean> {
    const effective = await this.options.access.listEffectiveAccess({
      organizationId: access.organization.id,
      userId: access.account.id,
      membershipId: access.membership.id,
    });
    return (
      effective?.owner === true ||
      effective?.grants.some(
        ({ resource, privileges }) =>
          resource.kind === "automation" &&
          resource.id === automationId &&
          resource.available &&
          privileges.includes("automation.run"),
      ) === true
    );
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
    if (request.method === "POST" && segments.length === 4 && segments[3] === "challenges") {
      this.requireMutation(request);
      const input = await parseBody(request, identityChallengeRequestSchema);
      const challenge = await this.options.access.issueChannelIdentityChallenge({
        organizationId: access.organization.id,
        userId: access.account.id,
        membershipId: access.membership.id,
        connectionId: input.connectionId,
      });
      return Response.json(
        {
          command: challenge.command,
          expiresAt: challenge.expiresAt.toISOString(),
        },
        { status: 201, headers: { "cache-control": "no-store" } },
      );
    }
    if (request.method === "POST" && segments.length === 3) {
      this.requireHubAction(access, "hub.access.manage");
      this.requireMutation(request);
      const account = await this.options.auth.resolveAccount(request);
      if (!account.isInstanceOperator) {
        return problem(
          requestId,
          403,
          "channel_identity_verification_required",
          "Use a provider verification flow to link this Channel identity.",
        );
      }
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
      const identity = (
        await this.options.access.listChannelIdentities(access.organization.id)
      ).find(({ id }) => id === segments[3]);
      if (
        identity !== undefined &&
        identity.memberId !== access.membership.id &&
        !access.capabilities.manageResources
      ) {
        return problem(
          requestId,
          404,
          "channel_identity_unavailable",
          "Channel identity is unavailable.",
        );
      }
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
    if (request.method === "PUT" && daemonId !== undefined && segments.length === 4) {
      this.requireMutation(request);
      this.requireHubAction(access, "hub.configure");
      if (!z.string().uuid().safeParse(daemonId).success) {
        return problem(requestId, 404, "daemon_unavailable", "Daemon is unavailable.");
      }
      if (this.options.renameDaemon === undefined) {
        return problem(requestId, 503, "daemon_unavailable", "Daemon management is unavailable.");
      }
      if (access.organization.slug === undefined) {
        return problem(
          requestId,
          409,
          "organization_unavailable",
          "The organization needs a URL slug before this Host can be renamed.",
        );
      }
      const canonicalUrl = new URL(request.url);
      canonicalUrl.searchParams.set("organizationSlug", access.organization.slug);
      return this.options.renameDaemon(new Request(canonicalUrl, request), daemonId);
    }
    if (request.method === "DELETE" && daemonId !== undefined && segments.length === 4) {
      this.requireMutation(request);
      this.requireHubAction(access, "hub.configure");
      if (!z.string().uuid().safeParse(daemonId).success) {
        return problem(requestId, 404, "daemon_unavailable", "Daemon is unavailable.");
      }
      const daemon = await this.options.database.findDaemonForOrganization(
        access.organization.id,
        daemonId,
      );
      if (daemon === undefined)
        return problem(requestId, 404, "daemon_unavailable", "Daemon is unavailable.");
      const authority = await this.options.access.resolveDaemonAccess({
        organizationId: access.organization.id,
        daemonId,
        userId: access.account.id,
        membershipId: access.membership.id,
      });
      if (
        authority === undefined ||
        (!authority.owner && !authority.permissions.includes("daemon.manage"))
      ) {
        return problem(requestId, 404, "daemon_unavailable", "Daemon is unavailable.");
      }
      if (this.options.revokeDaemon === undefined) {
        return problem(requestId, 503, "daemon_unavailable", "Daemon management is unavailable.");
      }
      if (access.organization.slug === undefined) {
        return problem(
          requestId,
          409,
          "organization_unavailable",
          "The organization needs a URL slug before this Host can be disconnected.",
        );
      }
      const canonicalUrl = new URL(request.url);
      canonicalUrl.searchParams.set("organizationSlug", access.organization.slug);
      return this.options.revokeDaemon(new Request(canonicalUrl, request), daemonId);
    }
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
        {
          accessTicket: ticket.accessTicket,
          expiresAt: ticket.expiresAt.toISOString(),
        },
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

  /** Maps semantic Hub actions onto the current fixed BetterAuth role capabilities. */
  private requireHubAction(
    access: OrganizationAccessValue,
    action: "hub.configure" | "hub.access.manage" | "channel.manage",
  ): void {
    const permitted = {
      "hub.configure": access.capabilities.manageResources,
      "hub.access.manage": access.capabilities.manageResources,
      "channel.manage": access.capabilities.manageResources,
    }[action];
    if (!permitted) {
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
                connectionOffer: daemon.connectionOffer,
                managedAccessMode: daemon.managedAccessMode,
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
        .select({
          teamId: schema.teamMembers.teamId,
          userId: schema.teamMembers.userId,
        })
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

  private async listTeamUserIds(organizationId: string, teamId: string): Promise<string[]> {
    return (
      await this.options.runtime
        .drizzle()
        .select({ userId: schema.teamMembers.userId })
        .from(schema.teamMembers)
        .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
        .where(and(eq(schema.teams.organizationId, organizationId), eq(schema.teams.id, teamId)))
    ).map(({ userId }) => userId);
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

function serializeTeam(team: typeof schema.teams.$inferSelect, userIds: readonly string[]) {
  return {
    id: team.id,
    name: team.name,
    userIds,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt?.toISOString() ?? null,
  };
}

function channelConfigurationView(snapshot: Awaited<ReturnType<typeof loadChannelControlPlane>>) {
  const resourceFile = snapshot.files.find(({ path }) => path === HUB_RESOURCE_PATH);
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
    resource:
      resourceFile === undefined
        ? null
        : z.record(z.string(), z.unknown()).parse(load(resourceFile.content)),
    policy,
    accounts,
    effective: snapshot.controlPlane,
  };
}

function channelRevisionSummary(revision: ChannelConfigurationRevisionRecord) {
  return {
    id: revision.id,
    version: revision.version,
    contentHash: revision.contentHash,
    createdByUserId: revision.createdByUserId,
    createdAt: revision.createdAt.toISOString(),
  };
}

function writeChannelConfiguration(
  existing: readonly HubBundleFile[],
  policy: z.infer<typeof OrgPolicySchema>,
  accounts: readonly z.infer<typeof AccountFileSchema>[],
  resource?: Readonly<Record<string, unknown>>,
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
    ...existing.filter(
      ({ path }) =>
        !path.startsWith(`${CHANNELS_DIRECTORY}/`) &&
        (resource === undefined || path !== HUB_RESOURCE_PATH),
    ),
    ...(resource === undefined
      ? []
      : [
          {
            path: HUB_RESOURCE_PATH,
            content: dump(resource, { lineWidth: -1 }),
          },
        ]),
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
    definition: load(editableAutomationYaml(revision.yaml, automation.enabled)),
    yaml: editableAutomationYaml(revision.yaml, automation.enabled),
    createdAt: automation.createdAt.toISOString(),
    updatedAt: automation.updatedAt.toISOString(),
  };
}

async function validateAutomation(
  request: Request,
  store: OrganizationTriggerStore,
): Promise<Response> {
  const input = await parseBody(request, automationCandidateSchema);
  const prepared = await store.validate(input.yaml);
  return Response.json({
    valid: true,
    name: prepared.compiled.authored.name,
    definition: prepared.compiled.authored,
  });
}

function runnableAutomationView(
  revision: OrganizationTriggerRevisionRecord,
  automation: OrganizationTriggerRecord,
) {
  const manual = parseCompiledHubConfig(revision.normalizedConfiguration).triggers.find(
    ({ on }) => on === "manual.run",
  );
  if (manual === undefined) return null;
  const definition: unknown = load(revision.yaml);
  let description: string | null = null;
  if (typeof definition === "object" && definition !== null && !Array.isArray(definition)) {
    const candidate: unknown = Reflect.get(definition, "description");
    if (typeof candidate === "string") description = candidate;
  }
  return {
    id: automation.id,
    name: automation.name,
    description,
    inputs: manual.inputs,
  };
}

function isPresent<Value>(value: Value | null): value is Value {
  return value !== null;
}

function automationRevisionView(revision: OrganizationTriggerRevisionRecord) {
  return {
    id: revision.id,
    version: revision.version,
    yaml: revision.yaml,
    definition: load(revision.yaml),
    contentHash: revision.contentHash,
    sourceKind: revision.sourceKind,
    createdByUserId: revision.createdByUserId,
    createdAt: revision.createdAt.toISOString(),
  };
}

function externalIdentityLabel(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  for (const key of ["username", "name", "id"] as const) {
    const candidate: unknown = Reflect.get(value, key);
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

function problem(requestId: string, status: number, error: string, message: string): Response {
  return Response.json({ error, message, requestId }, { status });
}

function channelAccountOperation(
  request: Request,
  segments: readonly string[],
): "conversations" | "activity" | "retry" | "test" | "test-preview" | undefined {
  if (segments.length !== 6) return undefined;
  if (request.method === "GET" && segments[5] === "conversations") return "conversations";
  if (request.method === "GET" && segments[5] === "activity") return "activity";
  if (request.method === "GET" && segments[5] === "test-preview") return "test-preview";
  if (request.method === "POST" && segments[5] === "retry") return "retry";
  if (request.method === "POST" && segments[5] === "test") return "test";
  return undefined;
}

function delegationPrincipal(access: OrganizationAccessValue) {
  return {
    organizationId: access.organization.id,
    userId: access.account.id,
    membershipId: access.membership.id,
  };
}

function connectionInUseProblem(
  requestId: string,
  consumers: readonly ConnectionConsumer[],
): Response {
  return Response.json(
    {
      error: "connection_in_use",
      message: "Move or remove every Channel account, Automation, and Project consumer first.",
      requestId,
      consumers,
    },
    { status: 409 },
  );
}

function providerApplicationProblem(requestId: string, error: ProviderApplicationError): Response {
  const status = providerApplicationErrorStatus(error.code);
  return problem(
    requestId,
    status,
    `provider_application_${error.code}`,
    error.safeContext ?? "The Provider Application request could not be completed.",
  );
}

function providerApplicationErrorStatus(code: ProviderApplicationError["code"]): number {
  if (code === "forbidden") return 403;
  if (code === "rateLimited") return 429;
  if (
    code === "identityConflict" ||
    code === "configurationConflict" ||
    code === "managedByEnvironment"
  ) {
    return 409;
  }
  if (
    code === "network" ||
    code === "timeout" ||
    code === "upstreamUnavailable" ||
    code === "internal"
  ) {
    return 503;
  }
  return 422;
}

function configuredChannelTestTarget(
  account: CompiledChannelAccount,
  input: { conversationId: string; threadId?: string | undefined },
): boolean {
  return account.routes.some(({ match }) =>
    match.ids.some(
      (id) =>
        id === input.conversationId || (input.threadId !== undefined && id === input.threadId),
    ),
  );
}
