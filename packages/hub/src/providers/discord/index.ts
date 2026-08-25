import type { AuthServer } from "../../auth/server.js";
import type { Database, DiscordConnectionRecord } from "../../db/types.js";
import { reportFailure } from "../../failures/index.js";
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
  requiredConnectionId,
  stateHash,
} from "../../connections/shared.js";
import { createDiscordBotClient, type DiscordBotClient } from "../../triggers/discord/bot.js";
import { createDiscordGatewaySource } from "../../triggers/discord/gateway.js";
import { createDiscordTriggerProvider } from "../../triggers/discord/provider.js";
import { createDiscordAttachmentResolver } from "../../triggers/discord/attachments.js";
import { createDiscordReplyExecutor } from "../../triggers/discord/reply.js";
import { outputContextProvider, replyOutputTool } from "../../execution-capabilities/outputs.js";
import {
  createDiscordConnectionClient,
  type DiscordConnectionClient,
  type DiscordGuildIdentity,
} from "./client.js";

export interface DiscordRegistrationConfiguration {
  botToken: string;
  clientId: string;
  clientSecret: string;
}

export interface CreateDiscordRegistrationOptions {
  database: Database | null;
  auth: AuthServer | null;
  applicationBaseUrl: string;
  publicBaseUrl?: string;
  configuration?: DiscordRegistrationConfiguration | null;
  bot?: DiscordBotClient;
  connectionClient?: DiscordConnectionClient;
  fetch?: typeof fetch;
  configurationVersion?: number;
}

interface DiscordConnectionOptions {
  database: Database;
  auth: AuthServer;
  applicationBaseUrl: string;
  callbackOrigin: string;
  configurationVersion: number;
  configuration: DiscordRegistrationConfiguration;
}

export function createDiscordRegistration(
  options: CreateDiscordRegistrationOptions,
): ProviderRegistration {
  const configuration = options.configuration ?? null;
  if (configuration === null || options.publicBaseUrl === undefined) {
    return emptyDiscordRegistration(options);
  }
  if (options.database === null) {
    return unavailableDiscordRegistration();
  }
  const database = options.database;

  const bot =
    options.bot ??
    createDiscordBotClient({
      token: configuration.botToken,
      clientId: configuration.clientId,
    });
  const client =
    options.connectionClient ??
    createDiscordConnectionClient({
      publicBaseUrl: options.publicBaseUrl,
      clientId: configuration.clientId,
      clientSecret: configuration.clientSecret,
      botToken: configuration.botToken,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  const connection =
    options.auth === null
      ? discordConnectionStatus(true)
      : createDiscordConnection(
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
  const gateway = createDiscordGatewaySource({
    bot,
    accept: (input) => database.acceptDiscordEvent(input),
    applyGuildDelete: (guildId, unavailable) =>
      applyGuildRemoval(database, client, guildId, unavailable),
  });
  return {
    configurationSnapshot: {
      version: options.configurationVersion ?? 0,
      callbackOrigin: options.publicBaseUrl,
    },
    connection,
    triggerProviders: [
      ({ configurationStoreForProject, attachments }) =>
        createDiscordTriggerProvider({
          configurationStoreForProject,
          ...(attachments === undefined ? {} : { attachments }),
          bot,
        }),
    ],
    sources: [gateway],
    outputs: [
      {
        type: "discord.reply",
        tool: replyOutputTool,
        available: outputContextProvider("discord"),
        execute: createDiscordReplyExecutor({ bot }),
      },
    ],
    requests: [],
    attachment: {
      provider: "discord",
      resolve: createDiscordAttachmentResolver(
        options.fetch === undefined ? {} : { fetch: options.fetch },
      ),
    },
  };
}

function emptyDiscordRegistration(
  options: Pick<CreateDiscordRegistrationOptions, "database" | "auth" | "applicationBaseUrl">,
): ProviderRegistration {
  const { database, auth } = options;
  const connection =
    database === null || auth === null
      ? discordConnectionStatus(false)
      : createDiscordConnection(
          {
            database,
            auth,
            applicationBaseUrl: options.applicationBaseUrl,
            callbackOrigin: options.applicationBaseUrl,
            configurationVersion: 0,
            configuration: {
              clientId: "unconfigured",
              clientSecret: "unconfigured",
              botToken: "unconfigured",
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

function unavailableDiscordRegistration(): ProviderRegistration {
  return {
    connection: discordConnectionStatus(true),
    triggerProviders: [],
    sources: [],
    outputs: [],
    requests: [],
  };
}

function discordConnectionStatus(configured: boolean): ProviderConnectionRegistration {
  return {
    name: "discord",
    status: (connections) => discordStatus(configured, connections.discord),
    actions: {},
  };
}

function createDiscordConnection(
  options: DiscordConnectionOptions,
  client: DiscordConnectionClient | undefined,
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
        provider: "discord",
        stateVerifier: stateHash(state),
        access: connectionAccess(access),
        lifetimeMinutes: CONNECTION_ATTEMPT_LIFETIME_MINUTES,
        callbackOrigin: options.callbackOrigin,
        configurationVersion: options.configurationVersion,
        providerApplicationId: options.configuration.clientId,
        configurationSnapshot: { provider: "discord", ...options.configuration },
        expectedConfigurationVersion: null,
        activateConfiguration: false,
      });
      return Response.json({ url: client.authorizationUrl(state) });
    } catch (error) {
      return connectionActionFailure(error, "discord", "start");
    }
  };

  const disconnect = async (request: Request): Promise<Response> => {
    const rejected = options.auth.rejectCookieMutation(request);
    if (rejected !== undefined) return rejected;
    try {
      const access = await manageConnectionAccess(options.auth, options.database, request);
      const disconnected = await options.database.disconnectConnection(
        "discord",
        requiredConnectionId(request),
        connectionAccess(access),
      );
      if (disconnected.provider === "discord" && disconnected.guildId !== undefined) {
        void client?.leaveGuild(disconnected.guildId).catch((error: unknown) => {
          reportFailure(
            error,
            {
              operation: "connection.disconnect.cleanup",
              component: "connections",
              provider: "discord",
            },
            { kind: "internal" },
          );
        });
      }
      return Response.json({ disconnected: true });
    } catch (error) {
      return connectionActionFailure(error, "discord", "disconnect");
    }
  };

  return {
    name: "discord",
    status: (connections) => discordStatus(client !== undefined, connections.discord),
    actions: {
      start,
      disconnect,
      callback: (request) => completeAuthorization(options, client, request),
    },
  };
}

async function completeAuthorization(
  options: DiscordConnectionOptions,
  client: DiscordConnectionClient | undefined,
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
      provider: "discord",
      phase: "discord_authorization",
      state,
      applicationBaseUrl: options.applicationBaseUrl,
    });
  }
  if (state === null || code === null || client === undefined) {
    return connectionCallbackFailure({
      error: new ProviderCallbackError("invalid_callback"),
      provider: "discord",
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
      phase: "discord_authorization",
      access,
    });
    returnRoute = attempt.returnRoute;
    callbackOrigin = attempt.callbackOrigin;
    const guild = await client.verifyGuild(code);
    if (guild === undefined) {
      await options.database.consumeConnectionAttempt({
        stateVerifier: stateHash(state),
        phase: "discord_authorization",
        access,
      });
      return connectionCallbackFailure({
        error: new ProviderCallbackError("Discord did not verify the selected server"),
        provider: "discord",
        phase: "authorization",
        applicationBaseUrl: callbackOrigin,
        returnRoute: attempt.returnRoute,
      });
    }
    await bindDiscord(options.database, state, access, guild, options.configuration.clientId);
    return connectionResult(callbackOrigin, attempt.returnRoute, "discord_connected", "discord");
  } catch (error) {
    return connectionCallbackFailure({
      error,
      provider: "discord",
      phase: "authorization",
      applicationBaseUrl: callbackOrigin,
      returnRoute,
    });
  }
}

class ProviderCallbackError extends Error {
  readonly code = "invalidInput";
}

async function bindDiscord(
  database: Database,
  state: string,
  access: Awaited<ReturnType<typeof callbackConnectionAccess>>,
  guild: DiscordGuildIdentity,
  providerApplicationId: string,
): Promise<void> {
  await database.bindDiscordConnection({
    providerApplicationId,
    stateVerifier: stateHash(state),
    phase: "discord_authorization",
    access,
    ...guild,
  });
}

async function applyGuildRemoval(
  database: Database,
  client: DiscordConnectionClient,
  guildId: string,
  unavailable: boolean,
): Promise<void> {
  if (unavailable) return;
  const membership = await client.guildMembership(guildId);
  if (membership === "absent") await database.removeDiscordConnection(guildId);
}

function discordStatus(configured: boolean, bindings: readonly DiscordConnectionRecord[]) {
  if (!configured) return { status: "notConfigured" as const };
  return bindings.length === 0
    ? { status: "disconnected" as const }
    : { status: "connected" as const };
}
