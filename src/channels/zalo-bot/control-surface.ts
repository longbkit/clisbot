import type { LoadedConfig } from "../../config/core/load-config.ts";
import { getAgentEntry } from "../../config/core/load-config.ts";
import {
  resolveZaloBotConfig,
  resolveZaloBotId,
  resolveZaloBotDirectMessageConfig,
} from "./config.ts";
import { resolveConfigTimezone } from "../../config/runtime/timezone.ts";
import { buildAgentPromptText } from "../message/agent-prompt.ts";
import {
  resolveChannelIdentityBotId,
  type ChannelIdentity,
} from "../surface/channel-identity.ts";
import type {
  ChannelBoundSurfaceRuntimeContext,
  ChannelControlSurfaceContext,
} from "../integration/channel-plugin.ts";
import type { MessageChildSurfaceSelector } from "../message/message-command.ts";
import {
  resolveConfiguredSurfaceModeTarget,
  buildConfiguredTargetFromIdentity,
  type ResponseMode,
  type StreamingMode,
} from "../config/surface-mode-config.ts";
import { resolveZaloBotConversationRoute } from "./route-config.ts";
import { resolveZaloBotConversationTarget } from "./session-routing.ts";
import { resolveZaloBotSurface } from "./surface.ts";

export function resolveZaloBotControlSurfaceContext(params: {
  loadedConfig: LoadedConfig;
  target: string;
  childSurface?: MessageChildSurfaceSelector;
  botId?: string;
}): ChannelControlSurfaceContext | null {
  const surface = resolveZaloBotSurface({
    rawTarget: params.target,
    childSurface: params.childSurface,
  });
  if (!surface) {
    return null;
  }
  if (surface.provider.chatType !== "PRIVATE") {
    throw new Error("Zalo Bot control targets support DM surfaces only.");
  }

  const botId = resolveZaloBotId(params.loadedConfig.raw.bots.zaloBot, params.botId);
  const routeInfo = resolveZaloBotConversationRoute({
    loadedConfig: params.loadedConfig,
    chatType: surface.provider.chatType,
    chatId: surface.provider.chatId,
    senderId: surface.provider.chatId,
    botId,
  });
  if (!routeInfo.route) {
    throw new Error(`Route not configured or not admitted for Zalo Bot target \`${params.target}\`.`);
  }
  const route = routeInfo.route;
  const sessionTarget = resolveZaloBotConversationTarget({
    loadedConfig: params.loadedConfig,
    agentId: route.agentId,
    botId,
    chatId: surface.provider.chatId,
    userId: routeInfo.conversationKind === "dm" ? surface.provider.chatId : undefined,
    conversationKind: routeInfo.conversationKind,
  });
  const identity = {
    platform: "zalo-bot" as const,
    botId,
    conversationKind: routeInfo.conversationKind,
    chatId: surface.provider.chatId,
  };
  const botConfig = resolveZaloBotConfig(params.loadedConfig.raw.bots.zaloBot, botId);
  const cliTool = getAgentEntry(params.loadedConfig, sessionTarget.agentId)?.cli;

  return {
    channel: "zalo-bot",
    botId,
    target: surface.provider.chatId,
    childSurface: surface.childSurface,
    surface,
    sessionTarget,
    identity,
    route,
    promptConfig: botConfig.agentPrompt,
    buildLoopPromptText: (text, options) =>
      buildAgentPromptText({
        text,
        identity,
        config: botConfig.agentPrompt,
        cliTool,
        responseMode: route.responseMode,
        streaming: route.streaming,
        agentId: sessionTarget.agentId,
        time: Date.now(),
        timezone: resolveConfigTimezone({
          config: params.loadedConfig.raw,
          agentId: sessionTarget.agentId,
          routeTimezone: route.timezone,
          botTimezone: route.botTimezone,
        }).timezone,
        maxProgressMessagesOverride: options?.maxProgressMessagesOverride,
      }),
  };
}

function resolveZaloBotSurfaceNotifications(identity: ChannelIdentity, loadedConfig: LoadedConfig) {
  const botId = resolveZaloBotId(
    loadedConfig.raw.bots.zaloBot,
    resolveChannelIdentityBotId(identity),
  );
  const channelConfig = resolveZaloBotConfig(loadedConfig.raw.bots.zaloBot, botId);
  const base = {
    queueStart: channelConfig.surfaceNotifications?.queueStart ?? "brief",
    loopStart: channelConfig.surfaceNotifications?.loopStart ?? "brief",
  };
  if (identity.conversationKind === "dm") {
    return {
      ...base,
      ...(resolveZaloBotDirectMessageConfig(channelConfig, identity.senderId)?.surfaceNotifications ?? {}),
    };
  }
  return {
    ...base,
  };
}

function resolveZaloBotConfiguredMode(
  loadedConfig: LoadedConfig,
  identity: ChannelIdentity,
  key: "responseMode",
): ResponseMode | undefined;
function resolveZaloBotConfiguredMode(
  loadedConfig: LoadedConfig,
  identity: ChannelIdentity,
  key: "streaming",
): StreamingMode | undefined;
function resolveZaloBotConfiguredMode(
  loadedConfig: LoadedConfig,
  identity: ChannelIdentity,
  key: "responseMode" | "streaming",
): ResponseMode | StreamingMode | undefined {
  try {
    return resolveConfiguredSurfaceModeTarget(
      loadedConfig.raw,
      key,
      buildConfiguredTargetFromIdentity(identity),
    ).get();
  } catch {
    return undefined;
  }
}

export function resolveZaloBotBoundSurfaceRuntimeContext(params: {
  loadedConfig: LoadedConfig;
  identity: ChannelIdentity;
}): ChannelBoundSurfaceRuntimeContext | null {
  const botId = resolveZaloBotId(
    params.loadedConfig.raw.bots.zaloBot,
    resolveChannelIdentityBotId(params.identity),
  );
  const identity = {
    ...params.identity,
    botId,
  };
  const channelConfig = resolveZaloBotConfig(params.loadedConfig.raw.bots.zaloBot, botId);
  const directMessageConfig = identity.conversationKind === "dm"
    ? resolveZaloBotDirectMessageConfig(channelConfig, identity.senderId)
    : undefined;

  return {
    identity,
    promptConfig: channelConfig.agentPrompt,
    responseMode:
      resolveZaloBotConfiguredMode(params.loadedConfig, identity, "responseMode") ??
      directMessageConfig?.responseMode ??
      channelConfig.responseMode,
    streaming:
      resolveZaloBotConfiguredMode(params.loadedConfig, identity, "streaming") ??
      directMessageConfig?.streaming ??
      channelConfig.streaming,
    surfaceNotifications: resolveZaloBotSurfaceNotifications(identity, params.loadedConfig),
  };
}
