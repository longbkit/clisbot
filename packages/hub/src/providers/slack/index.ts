import type { AuthServer } from "../../auth/server.js";
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
  requiredConnectionId,
  stateHash,
} from "../../connections/shared.js";
import { DatabaseUnavailableError } from "../../db/errors.js";
import type { BindSlackConnectionInput, Database, SlackConnectionRecord } from "../../db/types.js";
import { reportFailure } from "../../failures/index.js";
import { createSlackBotClient, type SlackBotClient } from "../../triggers/slack/client.js";
import { createSlackTriggerProvider } from "../../triggers/slack/provider.js";
import { createSlackAttachmentResolver } from "../../triggers/slack/attachments.js";
import { createSlackReplyExecutor } from "../../triggers/slack/reply.js";
import { outputContextProvider, replyOutputTool } from "../../execution-capabilities/outputs.js";
import { createSlackEventSource } from "../../triggers/slack/source/index.js";
import type { SlackSocketSourceOptions } from "../../triggers/slack/source/internal/socket.js";
import type { ProviderConnectionRegistration, ProviderRegistration } from "../registration.js";
import {
  createSlackConnectionClient,
  hasRequiredSlackScopes,
  type SlackConnectionClient,
  type SlackInstallation,
  SlackBotVerificationError,
} from "./client.js";

export type SlackRegistrationConfiguration =
  | {
      transport: "socket";
      appId: string;
      appToken: string;
    }
  | {
      transport: "webhook";
      appId: string;
      clientId: string;
      clientSecret: string;
      signingSecret: string;
    };

export interface CreateSlackRegistrationOptions {
  database: Database | null;
  auth: AuthServer | null;
  applicationBaseUrl: string;
  publicBaseUrl?: string;
  configuration?: SlackRegistrationConfiguration | null;
  connectionClient?: SlackConnectionClient;
  botClient?: SlackBotClient;
  fetch?: typeof fetch;
  socket?: Pick<SlackSocketSourceOptions, "apiUrl" | "random" | "timeoutMs">;
  configurationVersion?: number;
  expectedConfigurationVersion?: number;
  activateConfiguration?: boolean;
  onVerifiedInstallation?: (input: {
    configuration: unknown;
    expectedConfigurationVersion: number | undefined;
    callbackOrigin: string;
    userId: string;
    installation: SlackInstallation;
    binding: BindSlackConnectionInput;
  }) => Promise<void>;
}

interface SlackConnectionOptions {
  database: Database;
  auth: AuthServer;
  applicationBaseUrl: string;
  callbackOrigin: string;
  configurationVersion: number;
  configuration: SlackRegistrationConfiguration;
  expectedConfigurationVersion: number | undefined;
  activateConfiguration: boolean;
  onVerifiedInstallation: CreateSlackRegistrationOptions["onVerifiedInstallation"];
}

export function createSlackRegistration(
  options: CreateSlackRegistrationOptions,
): ProviderRegistration {
  const configuration = options.configuration ?? null;
  if (configuration === null || options.publicBaseUrl === undefined) {
    return emptySlackRegistration(options);
  }

  const connectionClient =
    configuration.transport === "webhook"
      ? (options.connectionClient ??
        createSlackConnectionClient({
          appId: configuration.appId,
          clientId: configuration.clientId,
          clientSecret: configuration.clientSecret,
          publicBaseUrl: options.publicBaseUrl,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        }))
      : undefined;
  const database = options.database;
  const accept =
    database === null
      ? () => Promise.reject(new DatabaseUnavailableError())
      : (
          input: Omit<
            Parameters<Database["acceptSlackEvent"]>[0],
            "providerApplicationId" | "providerConfigurationVersion"
          >,
        ) =>
          database.acceptSlackEvent({
            ...input,
            providerApplicationId: configuration.appId,
            providerConfigurationVersion: options.configurationVersion ?? 0,
          });
  const events = createSlackEventSource({
    configuration: { provider: "slack", ...configuration },
    accept,
    ...slackSocketOptions(options),
  });
  if (database === null) {
    return {
      connection: slackConnectionStatus(true),
      triggerProviders: [],
      sources: [events],
      outputs: [],
      requests:
        events.request === undefined ? [] : [{ name: "slack.events", handle: events.request }],
    };
  }

  const bot =
    options.botClient ??
    createSlackBotClient({
      tokenForWorkspace: async (organizationId, teamId) =>
        (await findSlackBindingForOrganization(database, organizationId, teamId))?.botAccessToken,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  const connection =
    options.auth === null
      ? slackConnectionStatus(true)
      : createSlackConnection(
          {
            database,
            auth: options.auth,
            applicationBaseUrl: options.applicationBaseUrl,
            callbackOrigin: options.publicBaseUrl,
            configurationVersion: options.configurationVersion ?? 0,
            configuration,
            expectedConfigurationVersion: options.expectedConfigurationVersion,
            activateConfiguration: options.activateConfiguration ?? false,
            onVerifiedInstallation: options.onVerifiedInstallation,
          },
          connectionClient,
        );

  return {
    configurationSnapshot: {
      version: options.configurationVersion ?? 0,
      callbackOrigin: options.publicBaseUrl,
    },
    connection,
    triggerProviders: [
      ({ configurationStoreForProject, attachments }) =>
        createSlackTriggerProvider({
          configurationStoreForProject,
          ...(attachments === undefined ? {} : { attachments }),
          botUserIdForWorkspace: async (organizationId, teamId) =>
            (await findSlackBindingForOrganization(database, organizationId, teamId))?.botUserId,
          client: bot,
        }),
    ],
    sources: [events],
    outputs: [
      {
        type: "slack.reply",
        tool: replyOutputTool,
        available: outputContextProvider("slack"),
        execute: createSlackReplyExecutor({ client: bot }),
      },
    ],
    requests:
      events.request === undefined ? [] : [{ name: "slack.events", handle: events.request }],
    attachment: { provider: "slack", resolve: createSlackAttachmentResolver(bot) },
    slackDelivery: { status: () => events.status(), retry: () => events.retry() },
  };
}

function slackSocketOptions(
  options: Pick<CreateSlackRegistrationOptions, "socket">,
): Pick<Parameters<typeof createSlackEventSource>[0], "socket"> {
  return options.socket === undefined ? {} : { socket: options.socket };
}

async function findSlackBindingForOrganization(
  database: Database,
  organizationId: string,
  teamId: string,
): Promise<SlackConnectionRecord | undefined> {
  const binding = await database.findSlackConnectionForOrganization(organizationId, teamId);
  return binding?.organizationId === organizationId && hasRequiredSlackScopes(binding.scopes)
    ? binding
    : undefined;
}

function emptySlackRegistration(
  options: Pick<CreateSlackRegistrationOptions, "database" | "auth" | "applicationBaseUrl">,
): ProviderRegistration {
  const connection =
    options.database === null || options.auth === null
      ? slackConnectionStatus(false)
      : createSlackConnection(
          {
            database: options.database,
            auth: options.auth,
            applicationBaseUrl: options.applicationBaseUrl,
            callbackOrigin: options.applicationBaseUrl,
            configurationVersion: 0,
            configuration: {
              transport: "webhook",
              appId: "unconfigured",
              clientId: "unconfigured",
              clientSecret: "unconfigured",
              signingSecret: "unconfigured",
            },
            expectedConfigurationVersion: undefined,
            activateConfiguration: false,
            onVerifiedInstallation: undefined,
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

function slackConnectionStatus(configured: boolean): ProviderConnectionRegistration {
  return {
    name: "slack",
    status: (connections) => slackStatus(configured, connections.slack),
    actions: {},
  };
}

function createSlackConnection(
  options: SlackConnectionOptions,
  client: SlackConnectionClient | undefined,
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
        provider: "slack",
        stateVerifier: stateHash(state),
        access: connectionAccess(access),
        lifetimeMinutes: CONNECTION_ATTEMPT_LIFETIME_MINUTES,
        callbackOrigin: options.callbackOrigin,
        configurationVersion: options.configurationVersion,
        providerApplicationId: options.configuration.appId,
        configurationSnapshot: { provider: "slack", ...options.configuration },
        expectedConfigurationVersion: options.expectedConfigurationVersion ?? null,
        activateConfiguration: options.activateConfiguration,
      });
      return Response.json({ url: client.authorizationUrl(state) });
    } catch (error) {
      return connectionActionFailure(error, "slack", "start");
    }
  };

  const disconnect = async (request: Request): Promise<Response> => {
    const rejected = options.auth.rejectCookieMutation(request);
    if (rejected !== undefined) return rejected;
    try {
      const access = await manageConnectionAccess(options.auth, options.database, request);
      const disconnected = await options.database.disconnectConnection(
        "slack",
        requiredConnectionId(request),
        connectionAccess(access),
      );
      if (disconnected.provider === "slack" && disconnected.botAccessToken !== undefined) {
        void client?.revoke(disconnected.botAccessToken).catch((error: unknown) => {
          reportFailure(
            error,
            {
              operation: "connection.disconnect.cleanup",
              component: "connections",
              provider: "slack",
            },
            { kind: "internal" },
          );
        });
      }
      return Response.json({ disconnected: true });
    } catch (error) {
      return connectionActionFailure(error, "slack", "disconnect");
    }
  };

  return {
    name: "slack",
    status: (connections) => slackStatus(client !== undefined, connections.slack),
    actions: {
      start,
      disconnect,
      callback: (request) => completeAuthorization(options, client, request),
    },
  };
}

async function completeAuthorization(
  options: SlackConnectionOptions,
  client: SlackConnectionClient | undefined,
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
      provider: "slack",
      phase: "slack_authorization",
      state,
      applicationBaseUrl: options.applicationBaseUrl,
    });
  }
  if (state === null || code === null || client === undefined) {
    return connectionCallbackFailure({
      error: new SlackCallbackError(),
      provider: "slack",
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
      phase: "slack_authorization",
      access,
    });
    returnRoute = attempt.returnRoute;
    callbackOrigin = attempt.callbackOrigin;
    const installation = await client.exchangeCode(code);
    await client.verifyInstallation(installation);
    if (!hasRequiredSlackScopes(installation.scopes)) throw new SlackBotVerificationError();
    const binding = slackBinding(state, access, installation);
    if (attempt.activateConfiguration) {
      if (options.onVerifiedInstallation === undefined) {
        throw new Error("Slack installation handler unavailable");
      }
      await options.onVerifiedInstallation({
        configuration: attempt.configurationSnapshot,
        expectedConfigurationVersion: attempt.expectedConfigurationVersion ?? undefined,
        callbackOrigin: attempt.callbackOrigin,
        userId: attempt.userId,
        installation,
        binding,
      });
    } else {
      await options.database.bindSlackConnection(binding);
    }
    return connectionResult(callbackOrigin, attempt.returnRoute, "slack_connected", "slack");
  } catch (error) {
    if (error instanceof SlackBotVerificationError) {
      reportFailure(
        error,
        {
          operation: "connection.callback.bot_verification",
          component: "connections",
          provider: "slack",
        },
        { kind: "permissionMissing" },
      );
      return connectionResult(callbackOrigin, returnRoute, "slack_bot_failed", "slack");
    }
    return connectionCallbackFailure({
      error,
      provider: "slack",
      phase: "authorization",
      applicationBaseUrl: callbackOrigin,
      returnRoute,
    });
  }
}

class SlackCallbackError extends Error {
  readonly code = "invalidInput";
  constructor() {
    super("invalid Slack callback");
  }
}

function slackBinding(
  state: string,
  access: Awaited<ReturnType<typeof callbackConnectionAccess>>,
  installation: SlackInstallation,
): BindSlackConnectionInput {
  return {
    providerApplicationId: installation.appId,
    stateVerifier: stateHash(state),
    phase: "slack_authorization",
    access,
    ...installation,
  };
}

function slackStatus(configured: boolean, bindings: readonly SlackConnectionRecord[]) {
  if (!configured) return { status: "notConfigured" as const };
  if (bindings.length === 0) return { status: "disconnected" as const };
  return bindings.some((binding) => !hasRequiredSlackScopes(binding.scopes))
    ? { status: "requiresReauthorization" as const }
    : { status: "connected" as const };
}
