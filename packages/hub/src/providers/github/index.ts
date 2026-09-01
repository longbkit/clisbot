import { createHash } from "node:crypto";
import type { AuthServer } from "../../auth/server.js";
import { createGitHubAuth, repositoryNamesForAccount, type GitHubAuth } from "../../auth/github.js";
import { DatabaseUnavailableError } from "../../db/errors.js";
import type { Database, GitHubConnectionRecord } from "../../db/types.js";
import { logger } from "../../logger.js";
import type { ProviderConnectionRegistration, ProviderRegistration } from "../registration.js";
import {
  CONNECTION_ATTEMPT_LIFETIME_MINUTES,
  callbackConnectionAccess,
  cancelledConnectionResult,
  connectionAccess,
  connectionActionFailure,
  connectionCallbackFailure,
  connectionResult,
  manageConnectionAccess,
  newConnectionState,
  positiveInteger,
  requiredConnectionId,
  stateHash,
} from "../../connections/shared.js";
import {
  createGitHubReactionClient,
  createGitHubTriggerProvider,
  type GitHubReactionClient,
} from "../../triggers/github/provider.js";
import { createWebhookSource } from "../../triggers/github/webhook.js";
import {
  createGitHubConnectionClient,
  type GitHubConnectionClient,
  type GitHubInstallationIdentity,
} from "./client.js";
import { PushPayloadSchema } from "../../auth/github-events.js";
import { synchronizeGitHubDefaultBranch } from "../../configuration/github-sync.js";
import type { GitHubConfigurationProvider } from "../../configuration/github-sync.js";
import { createGitHubConfigurationProvider } from "./configuration.js";
import type { ConnectionResolutionContext } from "../../config/connections.js";
import type { ProjectConfigurationStore } from "../../configuration/store.js";
import { replyOutputTool } from "../../execution-capabilities/outputs.js";
import { createGitHubReplyExecutor, githubReplyAvailable } from "../../triggers/github/reply.js";

export interface GitHubRegistrationConfiguration {
  appId: string;
  appSlug: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  /** Absent when event triggers are not set up. Deliveries are then refused, not accepted blind. */
  webhookSecret?: string;
}

export interface CreateGitHubRegistrationOptions {
  database: Database | null;
  auth: AuthServer | null;
  applicationBaseUrl: string;
  publicBaseUrl?: string;
  configuration?: GitHubRegistrationConfiguration | null;
  appAuth?: GitHubAuth;
  connectionClient?: GitHubConnectionClient;
  reactionClient?: GitHubReactionClient;
  fetch?: typeof fetch;
  configurationProvider?: GitHubConfigurationProvider;
  configurationVersion?: number;
}

interface GitHubConnectionOptions {
  database: Database;
  auth: AuthServer;
  applicationBaseUrl: string;
  callbackOrigin: string;
  configurationVersion: number;
  configuration: GitHubRegistrationConfiguration;
}

export function createGitHubRegistration(
  options: CreateGitHubRegistrationOptions,
): ProviderRegistration {
  const configuration = options.configuration ?? null;
  if (configuration === null || options.publicBaseUrl === undefined) {
    return emptyGitHubRegistration(options);
  }
  if (options.database === null) {
    return databaseUnavailableGitHubRegistration(configuration);
  }
  const database = options.database;
  let configurationForProject: ((projectId: string) => ProjectConfigurationStore) | undefined;

  const appAuth =
    options.appAuth ??
    createGitHubAuth({ appId: configuration.appId, privateKey: configuration.privateKey });
  const client =
    options.connectionClient ??
    createGitHubConnectionClient({
      publicBaseUrl: options.publicBaseUrl,
      appSlug: configuration.appSlug,
      clientId: configuration.clientId,
      clientSecret: configuration.clientSecret,
      appAuth,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  const connection =
    options.auth === null
      ? githubConnectionStatus(true)
      : createGitHubConnection(
          {
            database,
            auth: options.auth,
            applicationBaseUrl: options.applicationBaseUrl,
            callbackOrigin: options.publicBaseUrl,
            configurationVersion: options.configurationVersion ?? 0,
            configuration,
          },
          client,
        );
  const webhook = createWebhookSource(configuration.webhookSecret, {
    accept: (input) =>
      database.acceptGitHubEvent({
        ...input,
        providerApplicationId: configuration.appId,
        providerConfigurationVersion: options.configurationVersion ?? 0,
      }),
    applyLifecycle: (delivery) => applyLifecycle(database, client, delivery),
    async synchronizePush(input) {
      const payload = PushPayloadSchema.safeParse(input.payload);
      if (!payload.success) return;
      const incomingConnection = await database.findGitHubConnection(input.installationId);
      if (incomingConnection === undefined) return;
      const targets = await database.listGitHubConfigurationTargets(
        incomingConnection.organizationId,
        incomingConnection.id,
        input.repositoryId,
      );
      await Promise.all(
        targets
          .filter((target) => payload.data.ref === `refs/heads/${target.defaultBranch}`)
          .map((target) =>
            synchronizeGitHubDefaultBranch({
              database,
              client: githubConfiguration,
              projectId: target.projectId,
              repositoryId: input.repositoryId,
              expectedCommitSha: payload.data.after,
              webhookDeliveryId: input.deliveryId,
              configurationForProject: (projectId) => {
                if (configurationForProject === undefined) {
                  throw new Error("GitHub configuration store is not initialized");
                }
                return configurationForProject(projectId);
              },
            }),
          ),
      );
    },
  });
  const githubConfiguration =
    options.configurationProvider ?? createGitHubConfigurationProvider(appAuth);
  const reactions = options.reactionClient ?? createGitHubReactionClient(appAuth);
  logger.info("using webhook event source");
  return {
    configurationSnapshot: {
      version: options.configurationVersion ?? 0,
      callbackOrigin: options.publicBaseUrl,
    },
    connection,
    integration: {
      async resolve(projectId, connectionSlug, value, context?: ConnectionResolutionContext) {
        if (value !== "token") {
          throw new Error(`unsupported github integration value: ${value}`);
        }
        const project = await database.findProjectById(projectId);
        const selectedConnection =
          project === undefined
            ? undefined
            : (await database.organizationConnectionUsage(project.organizationId)).github.find(
                (candidate) =>
                  candidate.organizationId === project.organizationId &&
                  candidate.slug === connectionSlug,
              );
        if (selectedConnection === undefined || selectedConnection.status !== "active") {
          throw new Error(`github connection is unavailable: ${connectionSlug}`);
        }
        const token = await appAuth.mintInstallationToken(selectedConnection.installationId);
        await context?.registerToken?.(token, () => appAuth.revokeInstallationToken(token));
        return token;
      },
      githubAuthority: {
        async mint(input) {
          const project = await database.findProjectById(input.projectId);
          const selectedConnection =
            project === undefined
              ? undefined
              : (await database.organizationConnectionUsage(project.organizationId)).github.find(
                  (candidate) =>
                    candidate.organizationId === project.organizationId &&
                    candidate.slug === input.connectionSlug,
                );
          if (selectedConnection === undefined || selectedConnection.status !== "active") {
            throw new Error(`github connection is unavailable: ${input.connectionSlug}`);
          }
          repositoryNamesForAccount(input.repositories, selectedConnection.accountLogin);
          const token = await appAuth.mintInstallationAccessToken({
            installationId: selectedConnection.installationId,
            accountLogin: selectedConnection.accountLogin,
            repositories: input.repositories,
            permissions: input.permissions,
          });
          try {
            const bot = await appAuth.getAppBotIdentity(configuration.appSlug, token.token);
            return {
              token: token.token,
              expiresAt: token.expiresAt,
              botUserId: bot.id,
              botLogin: bot.login,
            };
          } catch (error) {
            await appAuth.revokeInstallationToken(token.token);
            throw error;
          }
        },
        revoke: (token) => appAuth.revokeInstallationToken(token),
      },
    },
    triggerProviders: [
      ({ configurationStoreForProject }) => {
        configurationForProject = configurationStoreForProject;
        return createGitHubTriggerProvider({
          configurationStoreForProject,
          reactions,
        });
      },
    ],
    sources: [webhook],
    outputs: [
      {
        type: "github.reply",
        tool: replyOutputTool,
        available: githubReplyAvailable,
        execute: createGitHubReplyExecutor({
          client: {
            async createIssueComment(input) {
              const octokit = await appAuth.createInstallationOctokit(input.installationId);
              await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
                owner: input.owner,
                repo: input.repo,
                issue_number: input.issueNumber,
                body: input.body,
              });
            },
          },
        }),
      },
    ],
    requests: [{ name: "webhook", handle: (request) => webhook.handle(request) }],
    githubConfiguration,
  };
}

function emptyGitHubRegistration(
  options: Pick<CreateGitHubRegistrationOptions, "database" | "auth" | "applicationBaseUrl">,
): ProviderRegistration {
  const { database, auth } = options;
  const connection =
    database === null || auth === null
      ? githubConnectionStatus(false)
      : createGitHubConnection(
          {
            database,
            auth,
            applicationBaseUrl: options.applicationBaseUrl,
            callbackOrigin: options.applicationBaseUrl,
            configurationVersion: 0,
            configuration: {
              appId: "unconfigured",
              appSlug: "unconfigured",
              clientId: "unconfigured",
              clientSecret: "unconfigured",
              privateKey: "unconfigured",
            },
          },
          undefined,
        );
  return {
    connection,
    triggerProviders: [],
    sources: [],
    outputs: [],
    requests: [],
  };
}

function databaseUnavailableGitHubRegistration(
  configuration: GitHubRegistrationConfiguration,
): ProviderRegistration {
  const unavailable = () => Promise.reject(new DatabaseUnavailableError());
  const webhook = createWebhookSource(configuration.webhookSecret, {
    accept: unavailable,
    applyLifecycle: unavailable,
  });
  return {
    connection: githubConnectionStatus(true),
    triggerProviders: [],
    sources: [webhook],
    outputs: [],
    requests: [{ name: "webhook", handle: (request) => webhook.handle(request) }],
  };
}

function githubConnectionStatus(configured: boolean): ProviderConnectionRegistration {
  return {
    name: "github",
    status: (connections) => githubStatus(configured, connections.github),
    actions: {},
  };
}

function createGitHubConnection(
  options: GitHubConnectionOptions,
  client: GitHubConnectionClient | undefined,
): ProviderConnectionRegistration {
  const start = async (request: Request): Promise<Response> => {
    const rejected = options.auth.rejectCookieMutation(request);
    if (rejected !== undefined) return rejected;
    try {
      const access = await manageConnectionAccess(options.auth, options.database, request);
      if (client === undefined) {
        return Response.json({ error: "provider_not_configured" }, { status: 409 });
      }
      const state = newConnectionState();
      await options.database.startConnectionAttempt({
        provider: "github",
        stateVerifier: stateHash(state),
        access: connectionAccess(access),
        lifetimeMinutes: CONNECTION_ATTEMPT_LIFETIME_MINUTES,
        callbackOrigin: options.callbackOrigin,
        configurationVersion: options.configurationVersion,
        providerApplicationId: options.configuration.appId,
        configurationSnapshot: { provider: "github", ...options.configuration },
        expectedConfigurationVersion: null,
        activateConfiguration: false,
      });
      return Response.json({ url: client.setupUrl(state) });
    } catch (error) {
      return connectionActionFailure(error, "github", "start");
    }
  };

  const disconnect = async (request: Request): Promise<Response> => {
    const rejected = options.auth.rejectCookieMutation(request);
    if (rejected !== undefined) return rejected;
    try {
      const access = await manageConnectionAccess(options.auth, options.database, request);
      await options.database.disconnectConnection(
        "github",
        requiredConnectionId(request),
        connectionAccess(access),
      );
      return Response.json({ disconnected: true });
    } catch (error) {
      return connectionActionFailure(error, "github", "disconnect");
    }
  };

  return {
    name: "github",
    status: (connections) => githubStatus(client !== undefined, connections.github),
    actions: {
      start,
      disconnect,
      setup: (request) => completeSetup(options, client, request),
      callback: (request) => completeAuthorization(options, client, request),
    },
  };
}

async function completeSetup(
  options: GitHubConnectionOptions,
  client: GitHubConnectionClient | undefined,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const installationId = positiveInteger(url.searchParams.get("installation_id"));
  const action = url.searchParams.get("setup_action");
  if (state === null || client === undefined)
    return connectionCallbackFailure({
      error: new GitHubCallbackError("invalid setup callback"),
      provider: "github",
      phase: "setup",
      applicationBaseUrl: options.applicationBaseUrl,
      returnRoute: "/",
    });
  let returnRoute = "/";
  let callbackOrigin = options.applicationBaseUrl;
  try {
    const access = await callbackConnectionAccess(options.auth, request);
    const attempt = await options.database.readConnectionAttempt({
      stateVerifier: stateHash(state),
      phase: "github_setup",
      access,
    });
    returnRoute = attempt.returnRoute;
    callbackOrigin = attempt.callbackOrigin;
    if (action === "request") {
      await options.database.consumeConnectionAttempt({
        stateVerifier: stateHash(state),
        phase: "github_setup",
        access,
      });
      return connectionResult(
        callbackOrigin,
        attempt.returnRoute,
        "github_approval_required",
        "github",
      );
    }
    if ((action !== "install" && action !== "update") || installationId === undefined) {
      return connectionCallbackFailure({
        error: new GitHubCallbackError("invalid setup result"),
        provider: "github",
        phase: "setup",
        applicationBaseUrl: callbackOrigin,
        returnRoute: attempt.returnRoute,
      });
    }
    const nextState = newConnectionState();
    const verifier = newConnectionState();
    await options.database.advanceGitHubConnectionAttempt({
      stateVerifier: stateHash(state),
      phase: "github_setup",
      access,
      nextStateVerifier: stateHash(nextState),
      installationId,
      pkceVerifier: verifier,
    });
    return Response.redirect(
      client.authorizationUrl({
        state: nextState,
        challenge: pkceChallenge(verifier),
      }),
      303,
    );
  } catch (error) {
    return connectionCallbackFailure({
      error,
      provider: "github",
      phase: "setup",
      applicationBaseUrl: callbackOrigin,
      returnRoute,
    });
  }
}

async function completeAuthorization(
  options: GitHubConnectionOptions,
  client: GitHubConnectionClient | undefined,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (state !== null && code === null && url.searchParams.get("error") === "access_denied") {
    return cancelledConnectionResult({
      auth: options.auth,
      database: options.database,
      request,
      provider: "github",
      phase: "github_user_authorization",
      state,
      applicationBaseUrl: options.applicationBaseUrl,
    });
  }
  if (state === null || code === null || client === undefined) {
    return connectionCallbackFailure({
      error: new GitHubCallbackError("invalid authorization callback"),
      provider: "github",
      phase: "authorization",
      applicationBaseUrl: options.applicationBaseUrl,
      returnRoute: "/",
    });
  }
  let returnRoute = "/";
  let callbackOrigin = options.applicationBaseUrl;
  try {
    const access = await callbackConnectionAccess(options.auth, request);
    const attempt = await options.database.readConnectionAttempt({
      stateVerifier: stateHash(state),
      phase: "github_user_authorization",
      access,
    });
    returnRoute = attempt.returnRoute;
    callbackOrigin = attempt.callbackOrigin;
    const installationId = positiveInteger(attempt.candidateExternalId);
    if (installationId === undefined || attempt.pkceVerifier === null)
      throw new Error("invalid attempt");
    const identity = await client.verifyUserInstallation({
      code,
      verifier: attempt.pkceVerifier,
      installationId,
    });
    if (identity === undefined) {
      await options.database.consumeConnectionAttempt({
        stateVerifier: stateHash(state),
        phase: "github_user_authorization",
        access,
      });
      return connectionCallbackFailure({
        error: new GitHubCallbackError("installation verification rejected"),
        provider: "github",
        phase: "authorization",
        applicationBaseUrl: callbackOrigin,
        returnRoute: attempt.returnRoute,
      });
    }
    await bindGitHub(options.database, state, access, identity, options.configuration.appId);
    return connectionResult(callbackOrigin, attempt.returnRoute, "github_connected", "github");
  } catch (error) {
    return connectionCallbackFailure({
      error,
      provider: "github",
      phase: "authorization",
      applicationBaseUrl: callbackOrigin,
      returnRoute,
    });
  }
}

class GitHubCallbackError extends Error {
  readonly code = "invalidInput";
}

async function bindGitHub(
  database: Database,
  state: string,
  access: Awaited<ReturnType<typeof callbackConnectionAccess>>,
  identity: GitHubInstallationIdentity,
  providerApplicationId: string,
): Promise<void> {
  await database.bindGitHubConnection({
    providerApplicationId,
    stateVerifier: stateHash(state),
    phase: "github_user_authorization",
    access,
    ...identity,
  });
}

interface GitHubLifecycleDelivery {
  installationId: number;
  event: "installation" | "installation_repositories";
  deliveryId: string;
  signatureHash: string;
  source: string;
  payload: unknown;
  receivedAt: Date;
}

async function applyLifecycle(
  database: Database,
  client: GitHubConnectionClient,
  delivery: GitHubLifecycleDelivery,
): Promise<void> {
  const claim = await database.claimGitHubLifecycleReceipt(delivery);
  if (claim.status === "duplicate") return;
  try {
    const evidence = await client.getInstallation(delivery.installationId);
    if (evidence.status === "absent") {
      await database.applyGitHubLifecycle(claim, {
        status: "absent",
        removeBinding: delivery.event === "installation",
      });
      return;
    }
    await database.applyGitHubLifecycle(claim, {
      status: "present",
      identity: evidence.identity,
    });
  } catch (error) {
    await database.releaseGitHubLifecycleReceipt(claim.providerEventReceiptId);
    throw error;
  }
}

function githubStatus(configured: boolean, bindings: readonly GitHubConnectionRecord[]) {
  if (!configured) return { status: "notConfigured" as const };
  if (bindings.length === 0) return { status: "disconnected" as const };
  return bindings.every((binding) => binding.status === "suspended")
    ? { status: "suspended" as const }
    : { status: "connected" as const };
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
