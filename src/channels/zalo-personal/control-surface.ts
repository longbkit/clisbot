import type { LoadedConfig } from "../../config/core/load-config.ts";
import { getAgentEntry } from "../../config/core/load-config.ts";
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
  buildConfiguredTargetFromIdentity,
  resolveConfiguredSurfaceModeTarget,
  type ResponseMode,
  type StreamingMode,
} from "../config/surface-mode-config.ts";
import {
  resolveZaloPersonalConfig,
  resolveZaloPersonalDirectMessageConfig,
  resolveZaloPersonalId,
} from "./config.ts";
import { resolveZaloPersonalConversationRoute } from "./route-config.ts";
import { resolveZaloPersonalConversationTarget } from "./session-routing.ts";
import { resolveZaloPersonalSurface } from "./surface.ts";

export function resolveZaloPersonalControlSurfaceContext(params: {
  loadedConfig: LoadedConfig;
  target: string;
  childSurface?: MessageChildSurfaceSelector;
  botId?: string;
}): ChannelControlSurfaceContext | null {
  const surface = resolveZaloPersonalSurface({
    rawTarget: params.target,
    childSurface: params.childSurface,
  });
  if (!surface) {
    return null;
  }
  const botId = resolveZaloPersonalId(params.loadedConfig.raw.bots.zaloPersonal, params.botId);
  const routeInfo = resolveZaloPersonalConversationRoute({
    loadedConfig: params.loadedConfig,
    conversationKind: surface.provider.conversationKind,
    chatId: surface.provider.chatId,
    senderId: surface.provider.userId,
    botId,
  });
  if (!routeInfo.route) {
    throw new Error(`Route not configured or not admitted for Zalo Personal target \`${params.target}\`.`);
  }
  const route = routeInfo.route;
  const sessionTarget = resolveZaloPersonalConversationTarget({
    loadedConfig: params.loadedConfig,
    agentId: route.agentId,
    botId,
    chatId: surface.provider.chatId,
    userId: surface.provider.userId,
    conversationKind: routeInfo.conversationKind,
  });
  const identity = {
    platform: "zalo-personal" as const,
    botId,
    conversationKind: routeInfo.conversationKind,
    chatId: surface.provider.chatId,
    senderId: surface.provider.userId,
  };
  const botConfig = resolveZaloPersonalConfig(params.loadedConfig.raw.bots.zaloPersonal, botId);
  const cliTool = getAgentEntry(params.loadedConfig, sessionTarget.agentId)?.cli;

  return {
    channel: "zalo-personal",
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

function resolveConfiguredMode(
  loadedConfig: LoadedConfig,
  identity: ChannelIdentity,
  key: "responseMode",
): ResponseMode | undefined;
function resolveConfiguredMode(
  loadedConfig: LoadedConfig,
  identity: ChannelIdentity,
  key: "streaming",
): StreamingMode | undefined;
function resolveConfiguredMode(
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

export function resolveZaloPersonalBoundSurfaceRuntimeContext(params: {
  loadedConfig: LoadedConfig;
  identity: ChannelIdentity;
}): ChannelBoundSurfaceRuntimeContext | null {
  const botId = resolveZaloPersonalId(
    params.loadedConfig.raw.bots.zaloPersonal,
    resolveChannelIdentityBotId(params.identity),
  );
  const identity = {
    ...params.identity,
    botId,
  };
  const channelConfig = resolveZaloPersonalConfig(params.loadedConfig.raw.bots.zaloPersonal, botId);
  const directMessageConfig = identity.conversationKind === "dm"
    ? resolveZaloPersonalDirectMessageConfig(channelConfig, identity.senderId)
    : undefined;
  return {
    identity,
    promptConfig: channelConfig.agentPrompt,
    responseMode:
      resolveConfiguredMode(params.loadedConfig, identity, "responseMode") ??
      directMessageConfig?.responseMode ??
      channelConfig.responseMode,
    streaming:
      resolveConfiguredMode(params.loadedConfig, identity, "streaming") ??
      directMessageConfig?.streaming ??
      channelConfig.streaming,
    surfaceNotifications: {
      queueStart: channelConfig.surfaceNotifications?.queueStart ?? "brief",
      loopStart: channelConfig.surfaceNotifications?.loopStart ?? "brief",
    },
  };
}
