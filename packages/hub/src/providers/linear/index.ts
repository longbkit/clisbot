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
import type {
  BindLinearConnectionInput,
  Database,
  LinearConnectionRecord,
} from "../../db/types.js";
import { outputContextProvider, replyOutputTool } from "../../execution-capabilities/outputs.js";
import { logger } from "../../logger.js";
import { createLinearTriggerProvider } from "../../triggers/linear/provider.js";
import { createLinearReplyExecutor } from "../../triggers/linear/reply.js";
import { createLinearWebhookSource } from "../../triggers/linear/webhook.js";
import type { ProviderConnectionRegistration, ProviderRegistration } from "../registration.js";
import {
  createLinearApiClient,
  createLinearConnectionClient,
  linearConnectionRequiresReauthorization,
  type LinearApiClient,
  type LinearConnectionClient,
  type LinearInstallation,
} from "./client.js";

export interface LinearRegistrationConfiguration {
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
}

export interface CreateLinearRegistrationOptions {
  database: Database | null;
  auth: AuthServer | null;
  applicationBaseUrl: string;
  publicBaseUrl?: string;
  environment?: NodeJS.ProcessEnv;
  configuration?: LinearRegistrationConfiguration | null;
  connectionClient?: LinearConnectionClient;
  apiClient?: LinearApiClient;
  fetch?: typeof fetch;
  configurationVersion?: number;
  expectedConfigurationVersion?: number;
  activateConfiguration?: boolean;
  onVerifiedInstallation?: (input: {
    configuration: unknown;
    expectedConfigurationVersion: number | undefined;
    callbackOrigin: string;
    userId: string;
    installation: LinearInstallation;
    binding: BindLinearConnectionInput;
  }) => Promise<void>;
}

interface LinearConnectionOptions {
  database: Database;
  auth: AuthServer;
  applicationBaseUrl: string;
  callbackOrigin: string;
  configurationVersion: number;
  configuration: LinearRegistrationConfiguration;
  expectedConfigurationVersion: number | undefined;
  activateConfiguration: boolean;
  onVerifiedInstallation: CreateLinearRegistrationOptions["onVerifiedInstallation"];
}

export function createLinearRegistration(
  options: CreateLinearRegistrationOptions,
): ProviderRegistration {
  const configuration = options.configuration ?? null;
  if (configuration === null || options.publicBaseUrl === undefined) {
    return emptyLinearRegistration(options);
  }
  const connectionClient =
    options.connectionClient ??
    createLinearConnectionClient({
      clientId: configuration.clientId,
      clientSecret: configuration.clientSecret,
      publicBaseUrl: options.publicBaseUrl,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  const database = options.database;
  const api =
    database === null
      ? undefined
      : (options.apiClient ??
        createLinearApiClient({
          connectionForLinearOrganization: (linearOrganizationId) =>
            database.findLinearConnection(linearOrganizationId),
          withLinearConnectionRefresh: database.withLinearConnectionRefresh.bind(database),
          connectionClient,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        }));
  const accept =
    database === null
      ? () => Promise.reject(new DatabaseUnavailableError())
      : (
          input: Omit<
            Parameters<Database["acceptLinearEvent"]>[0],
            "providerApplicationId" | "providerConfigurationVersion"
          >,
        ) =>
          database.acceptLinearEvent({
            ...input,
            providerApplicationId: configuration.clientId,
            providerConfigurationVersion: options.configurationVersion ?? 0,
          });
  const webhook = createLinearWebhookSource({
    signingSecret: configuration.webhookSecret,
    accept,
    ...(database === null
      ? {}
      : {
          canHydrateIssue: async (linearOrganizationId) => {
            const connection = await database.findLinearConnection(linearOrganizationId);
            return connection !== undefined && !linearConnectionRequiresReauthorization(connection);
          },
        }),
    ...(api === undefined
      ? {}
      : {
          resolveIssue: ({ linearOrganizationId, issueId }) =>
            api.readIssue({ linearOrganizationId, issueId }),
        }),
  });
  if (database === null) {
    return {
      connection: linearConnectionStatus(true),
      triggerProviders: [],
      sources: [webhook],
      outputs: [],
      requests: [{ name: "linear.events", handle: (request) => webhook.handle(request) }],
    };
  }
  const connection =
    options.auth === null
      ? linearConnectionStatus(true)
      : createLinearConnection(
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
      ({ configurationStoreForProject }) =>
        createLinearTriggerProvider({
          configurationStoreForProject,
          ...(api === undefined ? {} : { client: api }),
        }),
    ],
    sources: [webhook],
    outputs:
      api === undefined
        ? []
        : [
            {
              type: "linear.reply",
              tool: replyOutputTool,
              available: outputContextProvider("linear"),
              execute: createLinearReplyExecutor({ client: api }),
            },
          ],
    requests: [{ name: "linear.events", handle: (request) => webhook.handle(request) }],
  };
}

function emptyLinearRegistration(
  options: Pick<CreateLinearRegistrationOptions, "database" | "auth" | "applicationBaseUrl">,
): ProviderRegistration {
  const connection =
    options.database === null || options.auth === null
      ? linearConnectionStatus(false)
      : createLinearConnection(
          {
            database: options.database,
            auth: options.auth,
            applicationBaseUrl: options.applicationBaseUrl,
            callbackOrigin: options.applicationBaseUrl,
            configurationVersion: 0,
            configuration: {
              clientId: "unconfigured",
              clientSecret: "unconfigured",
              webhookSecret: "unconfigured",
            },
            expectedConfigurationVersion: undefined,
            activateConfiguration: false,
            onVerifiedInstallation: undefined,
          },
          undefined,
        );
  return { connection, triggerProviders: [], sources: [], outputs: [], requests: [] };
}

function linearConnectionStatus(configured: boolean): ProviderConnectionRegistration {
  return {
    name: "linear",
    status: (connections) => linearStatus(configured, connections.linear),
    actions: {},
  };
}

function createLinearConnection(
  options: LinearConnectionOptions,
  client: LinearConnectionClient | undefined,
): ProviderConnectionRegistration {
  const start = async (request: Request): Promise<Response> => {
    if (!isHttpsCallbackOrigin(options.callbackOrigin)) {
      return Response.json({ error: "https_required" }, { status: 400 });
    }
    const rejected = options.auth.rejectCookieMutation(request);
    if (rejected !== undefined) return rejected;
    try {
      const access = await manageConnectionAccess(options.auth, options.database, request);
      if (client === undefined)
        return Response.json({ error: "provider_not_configured" }, { status: 409 });
      const state = newConnectionState();
      await options.database.startConnectionAttempt({
        provider: "linear",
        stateVerifier: stateHash(state),
        access: connectionAccess(access),
        lifetimeMinutes: CONNECTION_ATTEMPT_LIFETIME_MINUTES,
        callbackOrigin: options.callbackOrigin,
        configurationVersion: options.configurationVersion,
        providerApplicationId: options.configuration.clientId,
        configurationSnapshot: { provider: "linear", ...options.configuration },
        expectedConfigurationVersion: options.expectedConfigurationVersion ?? null,
        activateConfiguration: options.activateConfiguration,
      });
      return Response.json({ url: client.authorizationUrl(state) });
    } catch (error) {
      return connectionActionFailure(error, "linear", "start");
    }
  };

  const disconnect = async (request: Request): Promise<Response> => {
    const rejected = options.auth.rejectCookieMutation(request);
    if (rejected !== undefined) return rejected;
    try {
      const access = await manageConnectionAccess(options.auth, options.database, request);
      const disconnected = await options.database.disconnectConnection(
        "linear",
        requiredConnectionId(request),
        connectionAccess(access),
      );
      if (disconnected.provider === "linear" && disconnected.accessToken !== undefined) {
        void client?.revoke(disconnected.accessToken).catch((error: unknown) => {
          logger.warn(
            { err: error, provider: "linear" },
            "provider cleanup failed after disconnect",
          );
        });
      }
      return Response.json({ disconnected: true });
    } catch (error) {
      return connectionActionFailure(error, "linear", "disconnect");
    }
  };

  return {
    name: "linear",
    status: (connections) => linearStatus(client !== undefined, connections.linear),
    actions: {
      start,
      disconnect,
      callback: (request) => completeAuthorization(options, client, request),
    },
  };
}

function isHttpsCallbackOrigin(value: string): boolean {
  try {
    const origin = new URL(value);
    return origin.protocol === "https:" && origin.username === "" && origin.password === "";
  } catch {
    return false;
  }
}

async function completeAuthorization(
  options: LinearConnectionOptions,
  client: LinearConnectionClient | undefined,
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
      provider: "linear",
      phase: "linear_authorization",
      state,
      applicationBaseUrl: options.applicationBaseUrl,
    });
  }
  if (state === null || code === null || client === undefined) {
    return connectionResult(options.applicationBaseUrl, "/", "connection_unavailable");
  }
  let returnRoute = "/";
  let callbackOrigin = options.applicationBaseUrl;
  try {
    const access = await callbackConnectionAccess(options.auth, request);
    const attempt = await options.database.readConnectionAttempt({
      stateVerifier: stateHash(state),
      phase: "linear_authorization",
      access,
    });
    returnRoute = attempt.returnRoute;
    callbackOrigin = attempt.callbackOrigin;
    const installation = await client.exchangeCode(code);
    const binding = linearBinding(state, access, installation, options.configuration.clientId);
    if (attempt.activateConfiguration) {
      if (options.onVerifiedInstallation === undefined) {
        throw new Error("Linear installation handler unavailable");
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
      await options.database.bindLinearConnection(binding);
    }
    return connectionResult(callbackOrigin, attempt.returnRoute, "linear_connected", "linear");
  } catch (error) {
    return connectionCallbackFailure({
      error,
      provider: "linear",
      phase: "authorization",
      applicationBaseUrl: callbackOrigin,
      returnRoute,
    });
  }
}

function linearBinding(
  state: string,
  access: Awaited<ReturnType<typeof callbackConnectionAccess>>,
  installation: LinearInstallation,
  providerApplicationId: string,
): BindLinearConnectionInput {
  return {
    stateVerifier: stateHash(state),
    phase: "linear_authorization",
    access,
    providerApplicationId,
    ...installation,
  };
}

function linearStatus(configured: boolean, bindings: readonly LinearConnectionRecord[]) {
  if (!configured) return { status: "notConfigured" as const };
  if (bindings.length === 0) return { status: "disconnected" as const };
  return bindings.some((binding) => linearConnectionRequiresReauthorization(binding))
    ? { status: "requiresReauthorization" as const }
    : { status: "connected" as const };
}
