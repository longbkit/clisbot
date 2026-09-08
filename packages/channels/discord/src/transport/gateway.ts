// L2 Discord gateway transport (blueprint §6.5 L2). Owns the socket lifetime and
// nothing else: it opens the ported gateway plugin's WebSocket, normalizes each
// `MESSAGE_CREATE` dispatch into the shared `ChannelInboundEvent`, and hands it
// to the L3 monitor. Dedupe, the durable queue admission and the Hub handoff all
// live in `@getpaseo/channels-shared`'s `createInboundEventProcessor`.
//
// D-DC-008: upstream's transport wiring is `monitor/gateway-plugin.ts`, which
// pulls OpenClaw's debug proxy-capture recorder (`plugin-sdk/proxy-capture`),
// its node proxy-agent factory, the voice-intent resolver and the runtime-env
// theme formatters. The socket construction, intent resolution and reconnect
// policy below are upstream's; the capture recorder and the voice intent are
// omitted with the surfaces they belong to.
//
// Discord's gateway has no per-message ACK and no cursor: the resume contract is
// `(session_id, seq)`, which the ported `GatewayPlugin` owns. Redelivery after a
// RESUME is therefore possible, and the queue's dedupe key — the message id,
// carried as `externalEventId` AND `externalMessageId` — is what makes a replay
// idempotent. The transport never advances anything before admission, so
// admission ordering is preserved by construction.
import { Agent as HttpsAgent } from "node:https";
import * as ws from "ws";
import type { ChannelInboundEvent, HostChildLogger } from "@getpaseo/channels-shared";
import type { APIMessage } from "discord-api-types/v10";
import type { DiscordIntentsConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { Client } from "../internal/client.js";
import { PaseoInteractionListener, registerDiscordPaseoCommand } from "../fusion/commands.js";
import * as discordGateway from "../internal/gateway.js";
import type { DiscordMessageDispatchData } from "../internal/listeners.js";
import { MessageCreateListener } from "../internal/listeners.js";
import { createDiscordDnsLookup } from "../network-config.js";
import { validateDiscordProxyUrl } from "../proxy-fetch.js";

const discordDnsLookup = createDiscordDnsLookup();

/**
 * Upstream `monitor/gateway-plugin.ts` `resolveDiscordGatewayIntents`, carried
 * unchanged except for the voice-states default (voice is omitted, so the intent
 * follows the explicit config only).
 */
export function resolveDiscordGatewayIntents(params?: {
  intentsConfig?: DiscordIntentsConfig;
}): number {
  const intentsConfig = params?.intentsConfig;
  let intents =
    discordGateway.GatewayIntents.Guilds |
    discordGateway.GatewayIntents.GuildExpressions |
    discordGateway.GatewayIntents.GuildMessages |
    discordGateway.GatewayIntents.DirectMessages |
    discordGateway.GatewayIntents.GuildMessageReactions |
    discordGateway.GatewayIntents.DirectMessageReactions;
  if (intentsConfig?.messageContent !== false) {
    intents |= discordGateway.GatewayIntents.MessageContent;
  }
  if (intentsConfig?.voiceStates) {
    intents |= discordGateway.GatewayIntents.GuildVoiceStates;
  }
  if (intentsConfig?.presence) {
    intents |= discordGateway.GatewayIntents.GuildPresences;
  }
  if (intentsConfig?.guildMembers) {
    intents |= discordGateway.GatewayIntents.GuildMembers;
  }
  return intents;
}

/**
 * How the transport stopped. `abort` is the normal lifetime end (the account
 * was stopped); `error` is a gateway fault the plugin cannot recover from, and
 * the account is parked as failed with the reason.
 */
export type DiscordGatewayOutcome = { stopped: "abort" } | { stopped: "error"; reason: string };

/**
 * The ported plugin's terminal `error` emissions (`internal/gateway.ts`): a
 * fatal close code (4004 bad token, 4014 disallowed intent, …) clears
 * `shouldReconnect`, and a spent reconnect budget stops scheduling. Everything
 * else it emits — an invalid payload, a socket error, a heartbeat-ACK timeout —
 * is followed by a reconnect, so it is logged and the socket keeps running.
 *
 * This couples to upstream's message text on purpose: the plugin exposes no
 * "is it still trying" flag, and the alternative (treat every `error` as
 * terminal) would kill an account on one dropped socket. Pinned by
 * `gateway.test.ts`, the same way `needs-login.ts` pins its markers.
 */
const TERMINAL_GATEWAY_ERRORS = [/^Fatal gateway close code:/u, /^Max reconnect attempts /u];

function isTerminalGatewayError(reason: string): boolean {
  return TERMINAL_GATEWAY_ERRORS.some((marker) => marker.test(reason));
}

export interface DiscordGatewayRunParams {
  accountId: string;
  token: string;
  /** The bot's own application/user id — the L3 own-message filter's key. */
  botId: string;
  applicationId: string;
  intents: number;
  proxyUrl?: string;
  abortSignal: AbortSignal;
  logger?: HostChildLogger;
  /** Test seam: a socket factory replacing the real `ws` client. */
  webSocketCtor?: typeof ws.WebSocket;
  onEvent: (event: ChannelInboundEvent) => Promise<unknown>;
}

/** DM channels have no guild; every other message arrives in a guild channel. */
function resolveChatType(data: DiscordMessageDispatchData): string {
  return data.guild_id ? "channel" : "direct";
}

/** Discord threads are channels: the thread id IS the channel id the message
 * arrived in, and the parent is carried separately. The Hub's thread key is the
 * channel id when the message sits in a thread, and null at a channel root. */
function resolveThreadId(data: DiscordMessageDispatchData): string | null {
  const raw = data.message.rawData as { thread?: { id?: string }; position?: number } | undefined;
  const parentId = (data.message.rawData as { channel_id?: string } | undefined)?.channel_id;
  return raw?.thread?.id ?? (parentId !== data.channel_id ? data.channel_id : null);
}

/**
 * Explicit-addressing fact. `WasMentioned` is a FACT the L3 passes through; the
 * Hub plane owns the mention POLICY (see `shared/src/monitor.ts`). A DM is
 * always explicitly addressed to the bot.
 */
function resolveWasMentioned(data: DiscordMessageDispatchData, botId: string): boolean {
  if (!data.guild_id) return true;
  const raw = data.message.rawData as
    | { mentions?: Array<{ id?: string }>; referenced_message?: { author?: { id?: string } } }
    | undefined;
  if (raw?.mentions?.some((user) => user.id === botId)) return true;
  return raw?.referenced_message?.author?.id === botId;
}

/** The ported dispatch payload → the channel-agnostic inbound event. */
export function normalizeDiscordMessage(params: {
  data: DiscordMessageDispatchData;
  accountId: string;
  botId: string;
}): ChannelInboundEvent | null {
  const { data, botId } = params;
  const author = data.author;
  if (author === null) return null;
  const messageId = data.message.id;
  if (!messageId) return null;
  const timestamp = data.message.timestamp;
  const timestampMs = timestamp ? Date.parse(timestamp) : Number.NaN;
  const threadId = resolveThreadId(data);
  const displayName = data.member?.nick ?? data.member?.nickname ?? author.globalName;
  return {
    channel: "discord",
    // Discord has no transport-level event id; the message id is the only stable
    // identity a RESUME redelivery repeats, so it is both dedupe keys.
    externalEventId: messageId,
    externalMessageId: messageId,
    externalConversationId: data.channel_id,
    chatType: resolveChatType(data),
    messageThreadId: threadId,
    senderId: author.id,
    ...(displayName ? { senderName: displayName } : {}),
    ...(author.username ? { senderUsername: author.username } : {}),
    body: data.message.content,
    wasMentioned: resolveWasMentioned(data, botId),
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : Date.now(),
    replyTo: data.channel_id,
    ...(data.guild?.name ? { conversationLabel: data.guild.name } : {}),
    isOwnMessage: author.id === botId || author.bot === true,
  };
}

/**
 * Opens the gateway and resolves when `abortSignal` fires — "start" is the
 * transport lifetime (docs/audits/pinned-vertical-contracts/start-account.md) —
 * or when the gateway reports a fault it cannot recover from.
 */
export async function runDiscordGateway(
  params: DiscordGatewayRunParams,
): Promise<DiscordGatewayOutcome> {
  const { logger } = params;
  const wsAgent = resolveGatewayAgent(params.proxyUrl, logger);
  const gateway = createGatewayPlugin({
    intents: params.intents,
    ...(wsAgent === undefined ? {} : { wsAgent }),
    ...(params.webSocketCtor === undefined ? {} : { webSocketCtor: params.webSocketCtor }),
  });
  // Subscribed BEFORE the Client is built, because constructing it connects the
  // socket (`GatewayPlugin.registerClient`) and a bad token can emit within the
  // same tick. `emitter` is a node EventEmitter: an unsubscribed "error" is
  // rethrown as an uncaught exception, which takes the Hub process down with
  // the account.
  const stopped = observeGatewayFaults(gateway, params);

  class InboundMessageListener extends MessageCreateListener {
    // The gateway dispatch mapper hands MESSAGE_CREATE listeners the enriched
    // `DiscordMessageDispatchData` (`internal/gateway-dispatch.ts`); upstream's
    // abstract signature still spells the raw `APIMessage`.
    override async handle(raw: APIMessage): Promise<void> {
      const data = raw as unknown as DiscordMessageDispatchData;
      const event = normalizeDiscordMessage({
        data,
        accountId: params.accountId,
        botId: params.botId,
      });
      if (event === null) return;
      // A throw here means durable admission failed. The gateway has nothing to
      // roll back (no ACK, no cursor); surface it and let the socket keep running
      // so the next dispatch is not lost too.
      try {
        await params.onEvent(event);
      } catch (error) {
        logger?.warn("discord inbound admission failed", {
          accountId: params.accountId,
          externalMessageId: event.externalMessageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // The Client is the ported SDK's plugin host: it owns the REST client, the
  // component registry and the listener table the gateway dispatches into.
  // `publicKey`/`baseUrl` belong to the HTTP interactions endpoint, which the
  // Hub does not expose; the routes are disabled instead of faked.
  const client = new Client(
    {
      baseUrl: "",
      clientId: params.applicationId,
      publicKey: "",
      token: params.token,
      autoDeploy: false,
      disableDeployRoute: true,
      disableInteractionsRoute: true,
      disableEventsRoute: true,
    },
    { listeners: [new InboundMessageListener(), new PaseoInteractionListener(params.applicationId, params.onEvent)] },
    [gateway],
  );
  try {
    await registerDiscordPaseoCommand(client);
    return await stopped.outcome;
  } finally {
    stopped.release();
    gateway.disconnect?.();
  }
}

/**
 * Turns the plugin's `error` emissions and the abort signal into the one
 * outcome the account lifecycle waits on. A recoverable fault is logged and the
 * socket keeps running; a terminal one parks the account with its reason.
 */
function observeGatewayFaults(
  gateway: discordGateway.GatewayPlugin,
  params: Pick<DiscordGatewayRunParams, "accountId" | "abortSignal" | "logger">,
): { outcome: Promise<DiscordGatewayOutcome>; release: () => void } {
  const { logger } = params;
  let settle: (outcome: DiscordGatewayOutcome) => void = () => undefined;
  const onError = (error: unknown): void => {
    const reason = error instanceof Error ? error.message : String(error);
    if (!isTerminalGatewayError(reason)) {
      logger?.warn("discord gateway error (reconnecting)", {
        accountId: params.accountId,
        error: reason,
      });
      return;
    }
    logger?.error?.("discord gateway stopped", { accountId: params.accountId, error: reason });
    settle({ stopped: "error", reason });
  };
  const onAbort = (): void => settle({ stopped: "abort" });
  gateway.emitter.on("error", onError);
  const outcome = new Promise<DiscordGatewayOutcome>((resolve) => {
    settle = resolve;
    if (params.abortSignal.aborted) {
      resolve({ stopped: "abort" });
      return;
    }
    params.abortSignal.addEventListener("abort", onAbort, { once: true });
  });
  return {
    outcome,
    release: () => {
      gateway.emitter.off("error", onError);
      params.abortSignal.removeEventListener("abort", onAbort);
    },
  };
}

function resolveGatewayAgent(
  proxyUrl: string | undefined,
  logger?: HostChildLogger,
): HttpsAgent | undefined {
  const base = new HttpsAgent({ lookup: discordDnsLookup });
  if (proxyUrl === undefined || proxyUrl === "") return base;
  try {
    validateDiscordProxyUrl(proxyUrl);
  } catch (error) {
    logger?.warn("discord: invalid gateway proxy, connecting directly", {
      error: error instanceof Error ? error.message : String(error),
    });
    return base;
  }
  // D-DC-008: upstream builds the tunnel through OpenClaw's `createNodeProxyAgent`.
  // Fusion has no equivalent yet, so a configured gateway proxy is refused loudly
  // rather than silently ignored.
  throw new Error(
    "discord: gateway proxy is configured but not supported by this build (D-DC-008)",
  );
}

function createGatewayPlugin(params: {
  intents: number;
  wsAgent?: HttpsAgent;
  webSocketCtor?: typeof ws.WebSocket;
}): discordGateway.GatewayPlugin {
  class FusionGatewayPlugin extends discordGateway.GatewayPlugin {
    constructor() {
      super({
        reconnect: { maxAttempts: 50 },
        intents: params.intents,
        // The Hub owns interaction dispatch; the plugin must not auto-answer.
        autoInteractions: false,
      });
    }

    override createWebSocket(url: string) {
      if (!url) {
        throw new Error("Gateway URL is required");
      }
      // Upstream avoids Node's undici-backed global WebSocket here: late
      // close-path crashes were seen during gateway teardown, and `ws` behaves
      // predictably for lifecycle cleanup.
      const WebSocketCtor = params.webSocketCtor ?? ws.WebSocket;
      const socket = new WebSocketCtor(url, {
        ...discordGateway.DISCORD_GATEWAY_WS_CLIENT_OPTIONS,
        ...(params.wsAgent ? { agent: params.wsAgent } : {}),
      });
      if ("binaryType" in socket) {
        try {
          socket.binaryType = "arraybuffer";
        } catch {
          // Ignore runtimes that expose a readonly binaryType.
        }
      }
      return socket;
    }
  }
  return new FusionGatewayPlugin();
}
