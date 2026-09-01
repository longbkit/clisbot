import { and, eq, isNull, or } from "drizzle-orm";
import { linearConnectionRequiresReauthorization } from "../providers/linear/client.js";
import type { DrizzleHandle } from "./runtime/index.js";
import * as schema from "./schema.js";
import { ConnectionRepository } from "./connections.js";
import type {
  AcceptDiscordEventInput,
  AcceptGitHubEventInput,
  AcceptLinearEventInput,
  AcceptSlackEventInput,
  GitHubLifecycleReceiptClaim,
  GitHubLifecycleReceiptClaimInput,
  GitHubLifecycleResult,
  ManualEventPersistence,
  PersistManualEventInput,
  ProviderEventAcceptance,
  ProviderEventEvidence,
  ProviderEventRouteSnapshot,
} from "./types.js";

type HubDatabase = DrizzleHandle;
type HubTransaction = Parameters<Parameters<HubDatabase["transaction"]>[0]>[0];

const GITHUB_LIFECYCLE = "github_lifecycle";

export class ProviderEventAcceptanceRepository {
  constructor(
    private readonly database: HubDatabase,
    private readonly connections: ConnectionRepository,
  ) {}

  acceptGitHub(input: AcceptGitHubEventInput): Promise<ProviderEventAcceptance> {
    return this.acceptProvider("github", input.installationId, input.repositoryId, input);
  }

  acceptDiscord(input: AcceptDiscordEventInput): Promise<ProviderEventAcceptance> {
    return this.acceptProvider("discord", input.guildId, input.guildId, input);
  }

  acceptSlack(input: AcceptSlackEventInput): Promise<ProviderEventAcceptance> {
    return this.acceptProvider("slack", input.teamId, input.teamId, input);
  }

  acceptLinear(input: AcceptLinearEventInput): Promise<ProviderEventAcceptance> {
    return this.acceptProvider("linear", input.linearOrganizationId, input.projectId, input);
  }

  private async acceptProvider(
    provider: "github" | "slack" | "discord" | "linear",
    externalId: number | string,
    resourceId: number | string | undefined,
    input: ProviderEventEvidence,
  ): Promise<ProviderEventAcceptance> {
    return this.database.transaction(async (transaction) => {
      const connection = await findConnection(transaction, provider, externalId);
      if (connection === undefined) {
        return { status: "dropped", receiptId: input.deliveryId, reason: `${provider}_unbound` };
      }

      const existing = await findReceipt(transaction, input, connection.organizationId);
      if (existing !== undefined) return replayProviderReceipt(existing);

      const dropReason =
        input.dropReason ??
        ((provider === "github" && "status" in connection && connection.status === "suspended") ||
        (provider === "linear" && linearConnectionUnavailable(connection, input.receivedAt))
          ? "configuration_unavailable"
          : undefined);
      const receipt = await claimProviderReceipt(transaction, {
        organizationId: connection.organizationId,
        provider,
        connectionId: connection.id,
        resourceId: resourceId === undefined ? null : String(resourceId),
        input: dropReason === undefined ? input : { ...input, dropReason },
      });
      if (!receipt.inserted) {
        const existingReceipt = await findReceipt(transaction, input, connection.organizationId);
        if (existingReceipt === undefined) throw new Error("provider receipt unavailable");
        return replayProviderReceipt(existingReceipt);
      }
      if (dropReason !== undefined) {
        return { status: "dropped", receiptId: receipt.id, reason: dropReason };
      }

      const routes = await transaction
        .select({
          projectId: schema.projectTriggerRoutes.projectId,
          revisionId: schema.projectTriggerRoutes.configurationRevisionId,
          connectionId: schema.projectTriggerRoutes.connectionId,
          resourceId: schema.projectTriggerRoutes.resourceId,
        })
        .from(schema.projectTriggerRoutes)
        .innerJoin(
          schema.projects,
          and(
            eq(schema.projects.id, schema.projectTriggerRoutes.projectId),
            eq(schema.projects.organizationId, connection.organizationId),
            eq(schema.projects.status, "active"),
            eq(
              schema.projects.activeConfigurationRevisionId,
              schema.projectTriggerRoutes.configurationRevisionId,
            ),
          ),
        )
        .where(
          and(
            eq(schema.projectTriggerRoutes.organizationId, connection.organizationId),
            eq(schema.projectTriggerRoutes.provider, provider),
            eq(schema.projectTriggerRoutes.connectionId, connection.id),
            or(
              isNull(schema.projectTriggerRoutes.resourceId),
              eq(
                schema.projectTriggerRoutes.resourceId,
                resourceId === undefined ? "" : String(resourceId),
              ),
            ),
          ),
        );

      const selectedRoutes = selectFirstRoutePerProject(routes);
      if (selectedRoutes.length === 0) {
        const reason = "no_project_route";
        await transaction
          .update(schema.providerEventReceipts)
          .set({ droppedReason: reason })
          .where(eq(schema.providerEventReceipts.id, receipt.id));
        return { status: "dropped", receiptId: receipt.id, reason };
      }

      const acceptedRoutes: ProviderEventRouteSnapshot[] = selectedRoutes.map((route) => ({
        projectId: route.projectId,
        configurationRevisionId: route.revisionId,
        connectionId: route.connectionId,
        resourceId: route.resourceId,
      }));
      await transaction
        .update(schema.providerEventReceipts)
        .set({ acceptedRoutes })
        .where(eq(schema.providerEventReceipts.id, receipt.id));

      return {
        status: "accepted",
        events: acceptedRoutes.map((route) => ({
          providerEventReceiptId: receipt.id,
          organizationId: connection.organizationId,
          projectId: route.projectId,
          configurationRevisionId: route.configurationRevisionId,
          deliveryId: input.deliveryId,
          source: input.source,
          payload: input.payload,
          receivedAt: input.receivedAt,
          connectionId: route.connectionId,
          resourceId: route.resourceId,
        })),
        receiptId: receipt.id,
      };
    });
  }

  persistManual(input: PersistManualEventInput): Promise<ManualEventPersistence> {
    return this.database.transaction(async (transaction) => {
      const existing = await findReceipt(transaction, input, input.organizationId);
      if (existing !== undefined) {
        const route = parseAcceptedRoutes(existing.acceptedRoutes)?.[0];
        if (route === undefined) {
          return { status: "duplicate", providerEventReceiptId: existing.id };
        }
        return {
          status: "accepted",
          event: eventFromReceipt(existing, route),
        };
      }
      const [project] = await transaction
        .select({ configurationRevisionId: schema.projects.activeConfigurationRevisionId })
        .from(schema.projects)
        .where(
          and(
            eq(schema.projects.id, input.projectId),
            eq(schema.projects.organizationId, input.organizationId),
            eq(schema.projects.status, "active"),
          ),
        );
      if (project?.configurationRevisionId === null || project === undefined) {
        throw new Error("manual project configuration unavailable");
      }
      const route: ProviderEventRouteSnapshot = {
        projectId: input.projectId,
        configurationRevisionId: project.configurationRevisionId,
        connectionId: input.connectionId ?? null,
        resourceId: input.resourceId ?? null,
      };
      const receipt = await claimProviderReceipt(transaction, {
        organizationId: input.organizationId,
        provider: "manual",
        connectionId: null,
        resourceId: null,
        input,
      });
      if (!receipt.inserted) {
        const duplicate = await findReceipt(transaction, input, input.organizationId);
        const duplicateRoute = parseAcceptedRoutes(duplicate?.acceptedRoutes)?.[0];
        if (duplicate === undefined || duplicateRoute === undefined) {
          return { status: "duplicate", providerEventReceiptId: receipt.id };
        }
        return { status: "accepted", event: eventFromReceipt(duplicate, duplicateRoute) };
      }
      await transaction
        .update(schema.providerEventReceipts)
        .set({ acceptedRoutes: [route] })
        .where(eq(schema.providerEventReceipts.id, receipt.id));
      return {
        status: "accepted",
        event: {
          providerEventReceiptId: receipt.id,
          organizationId: input.organizationId,
          projectId: input.projectId,
          configurationRevisionId: route.configurationRevisionId,
          deliveryId: input.deliveryId,
          source: input.source,
          payload: input.payload,
          receivedAt: input.receivedAt,
          connectionId: input.connectionId ?? null,
          resourceId: input.resourceId ?? null,
        },
      };
    });
  }

  claimGitHubLifecycleReceipt(
    input: GitHubLifecycleReceiptClaimInput,
  ): Promise<GitHubLifecycleReceiptClaim> {
    return this.database.transaction(async (transaction) => {
      const [connection] = await transaction
        .select({
          id: schema.githubConnections.id,
          organizationId: schema.githubConnections.organizationId,
        })
        .from(schema.githubConnections)
        .where(eq(schema.githubConnections.installationId, input.installationId));
      if (connection === undefined) {
        return { status: "duplicate", providerEventReceiptId: input.deliveryId };
      }
      const receipt = await claimProviderReceipt(transaction, {
        organizationId: connection.organizationId,
        provider: "github",
        connectionId: connection.id,
        resourceId: null,
        input: { ...input, dropReason: GITHUB_LIFECYCLE },
      });
      if (!receipt.inserted) {
        return { status: "duplicate", providerEventReceiptId: receipt.id };
      }
      return {
        status: "claimed",
        providerEventReceiptId: receipt.id,
        installationId: input.installationId,
      };
    });
  }

  applyGitHubLifecycle(
    claim: Extract<GitHubLifecycleReceiptClaim, { status: "claimed" }>,
    result: GitHubLifecycleResult,
  ): Promise<void> {
    return this.database.transaction(async (transaction) => {
      const [evidence] = await transaction
        .select({ id: schema.providerEventReceipts.id })
        .from(schema.providerEventReceipts)
        .where(
          and(
            eq(schema.providerEventReceipts.id, claim.providerEventReceiptId),
            eq(schema.providerEventReceipts.droppedReason, GITHUB_LIFECYCLE),
          ),
        )
        .for("update");
      if (evidence === undefined) return;
      if (result.status === "absent") {
        if (result.removeBinding) {
          await this.connections.removeGitHubByInstallationInTransaction(
            transaction,
            claim.installationId,
          );
        }
        return;
      }
      await transaction
        .update(schema.githubConnections)
        .set({
          accountId: result.identity.accountId,
          accountLogin: result.identity.accountLogin,
          accountType: result.identity.accountType,
          status: result.identity.status,
          suspendedAt: result.identity.status === "suspended" ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(schema.githubConnections.installationId, claim.installationId));
    });
  }

  async releaseGitHubLifecycleReceipt(providerEventReceiptId: string): Promise<void> {
    await this.database
      .delete(schema.providerEventReceipts)
      .where(eq(schema.providerEventReceipts.id, providerEventReceiptId));
  }
}

function linearConnectionUnavailable(connection: object, receivedAt: Date): boolean {
  if (!("scopes" in connection) || !isStringArray(connection.scopes)) return true;
  if (
    !("refreshToken" in connection) ||
    (connection.refreshToken !== null && typeof connection.refreshToken !== "string")
  ) {
    return true;
  }
  if (
    !("accessTokenExpiresAt" in connection) ||
    (connection.accessTokenExpiresAt !== null && !(connection.accessTokenExpiresAt instanceof Date))
  ) {
    return true;
  }
  return linearConnectionRequiresReauthorization(
    {
      scopes: connection.scopes,
      refreshToken: connection.refreshToken,
      accessTokenExpiresAt: connection.accessTokenExpiresAt,
    },
    receivedAt,
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function eventFromReceipt(
  receipt: typeof schema.providerEventReceipts.$inferSelect,
  route: ProviderEventRouteSnapshot,
): import("./types.js").DurableProviderEvent {
  return {
    providerEventReceiptId: receipt.id,
    organizationId: receipt.organizationId,
    projectId: route.projectId,
    configurationRevisionId: route.configurationRevisionId,
    deliveryId: receipt.deliveryId,
    source: receipt.source,
    payload: receipt.payload,
    receivedAt: receipt.receivedAt,
    connectionId: route.connectionId,
    resourceId: route.resourceId,
  };
}

async function findReceipt(
  transaction: HubTransaction,
  input: ProviderEventEvidence,
  organizationId: string,
) {
  const [receipt] = await transaction
    .select()
    .from(schema.providerEventReceipts)
    .where(
      and(
        eq(schema.providerEventReceipts.organizationId, organizationId),
        input.signatureHash === undefined || input.signatureHash === null
          ? eq(schema.providerEventReceipts.deliveryId, input.deliveryId)
          : or(
              eq(schema.providerEventReceipts.deliveryId, input.deliveryId),
              eq(schema.providerEventReceipts.signatureHash, input.signatureHash),
            ),
      ),
    )
    .limit(1);
  return receipt;
}

function replayProviderReceipt(
  receipt: typeof schema.providerEventReceipts.$inferSelect,
): ProviderEventAcceptance {
  if (receipt.droppedReason !== null) {
    return { status: "dropped", receiptId: receipt.id, reason: receipt.droppedReason };
  }
  const routes = parseAcceptedRoutes(receipt.acceptedRoutes);
  if (routes === null) return { status: "duplicate", receiptId: receipt.id };
  return {
    status: "accepted",
    receiptId: receipt.id,
    events: routes.map((route) => ({
      providerEventReceiptId: receipt.id,
      organizationId: receipt.organizationId,
      projectId: route.projectId,
      configurationRevisionId: route.configurationRevisionId,
      deliveryId: receipt.deliveryId,
      source: receipt.source,
      payload: receipt.payload,
      receivedAt: receipt.receivedAt,
      connectionId: route.connectionId,
      resourceId: route.resourceId,
    })),
  };
}

function parseAcceptedRoutes(value: unknown): ProviderEventRouteSnapshot[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) throw new Error("invalid accepted provider routes");
  return value.map((candidate) => {
    if (!isRecord(candidate)) throw new Error("invalid accepted provider route");
    const projectId = candidate["projectId"];
    const configurationRevisionId = candidate["configurationRevisionId"];
    const connectionId = candidate["connectionId"];
    const resourceId = candidate["resourceId"];
    if (
      typeof projectId !== "string" ||
      typeof configurationRevisionId !== "string" ||
      (connectionId !== null && typeof connectionId !== "string") ||
      (resourceId !== null && typeof resourceId !== "string")
    ) {
      throw new Error("invalid accepted provider route");
    }
    return { projectId, configurationRevisionId, connectionId, resourceId };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function selectFirstRoutePerProject<Route extends { projectId: string }>(
  routes: readonly Route[],
): Route[] {
  const selected = new Map<string, Route>();
  for (const route of routes) {
    if (!selected.has(route.projectId)) selected.set(route.projectId, route);
  }
  return [...selected.values()];
}

async function findConnection(
  transaction: HubTransaction,
  provider: "github" | "slack" | "discord" | "linear",
  externalId: number | string,
) {
  if (provider === "github") {
    const [row] = await transaction
      .select({
        id: schema.githubConnections.id,
        organizationId: schema.githubConnections.organizationId,
        status: schema.githubConnections.status,
      })
      .from(schema.githubConnections)
      .where(eq(schema.githubConnections.installationId, Number(externalId)))
      .limit(1);
    return row;
  }
  if (provider === "slack") {
    const [row] = await transaction
      .select({
        id: schema.slackConnections.id,
        organizationId: schema.slackConnections.organizationId,
      })
      .from(schema.slackConnections)
      .where(eq(schema.slackConnections.teamId, String(externalId)))
      .limit(1);
    return row;
  }
  if (provider === "linear") {
    const [row] = await transaction
      .select({
        id: schema.linearConnections.id,
        organizationId: schema.linearConnections.organizationId,
        scopes: schema.linearConnections.scopes,
        refreshToken: schema.linearConnections.refreshToken,
        accessTokenExpiresAt: schema.linearConnections.accessTokenExpiresAt,
      })
      .from(schema.linearConnections)
      .where(eq(schema.linearConnections.linearOrganizationId, String(externalId)))
      .limit(1);
    return row;
  }
  const [row] = await transaction
    .select({
      id: schema.discordConnections.id,
      organizationId: schema.discordConnections.organizationId,
    })
    .from(schema.discordConnections)
    .where(eq(schema.discordConnections.guildId, String(externalId)))
    .limit(1);
  return row;
}

async function claimProviderReceipt(
  transaction: HubTransaction,
  input: {
    organizationId: string;
    provider: "github" | "slack" | "discord" | "linear" | "manual";
    connectionId: string | null;
    resourceId: string | null;
    input: ProviderEventEvidence;
  },
): Promise<{ id: string; inserted: boolean }> {
  const [receipt] = await transaction
    .insert(schema.providerEventReceipts)
    .values({
      organizationId: input.organizationId,
      provider: input.provider,
      connectionId: input.connectionId,
      resourceId: input.resourceId,
      deliveryId: input.input.deliveryId,
      signatureHash: input.input.signatureHash ?? null,
      providerApplicationId: input.input.providerApplicationId ?? null,
      providerConfigurationVersion: input.input.providerConfigurationVersion ?? null,
      source: input.input.source,
      repo: input.input.repo ?? null,
      payload: input.input.payload,
      receivedAt: input.input.receivedAt,
      droppedReason: input.input.dropReason ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: schema.providerEventReceipts.id });
  if (receipt !== undefined) return { id: receipt.id, inserted: true };

  const existing = await findReceipt(transaction, input.input, input.organizationId);
  if (existing === undefined) throw new Error("provider receipt unavailable");
  return { id: existing.id, inserted: false };
}
