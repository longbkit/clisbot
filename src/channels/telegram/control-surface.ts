import type { LoadedConfig } from "../../config/core/load-config.ts";
import { getAgentEntry } from "../../config/core/load-config.ts";
import {
  resolveTelegramBotConfig,
  resolveTelegramBotId,
  resolveTelegramDirectMessageConfig,
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
import { resolveSharedGroupsWildcardRoute } from "../../config/channels/group-routes.ts";
import { resolveTelegramConversationRoute } from "./route-config.ts";
import { resolveTelegramConversationTarget } from "./session-routing.ts";
import { resolveTelegramSurface } from "./surface.ts";

export function resolveTelegramControlSurfaceContext(params: {
  loadedConfig: LoadedConfig;
  target: string;
  childSurface?: MessageChildSurfaceSelector;
  botId?: string;
}): ChannelControlSurfaceContext | null {
  const normalized = normalizeTelegramControlTarget(params.target, params.childSurface);
  const surface = resolveTelegramSurface({
    rawTarget: normalized.chatId,
    childSurface: normalized.childSurface,
  });
  if (!surface) {
    return null;
  }

  const botId = resolveTelegramBotId(params.loadedConfig.raw.bots.telegram, params.botId);
  const routeInfo = resolveTelegramConversationRoute({
    loadedConfig: params.loadedConfig,
    chatType: surface.provider.chatType,
    chatId: surface.provider.chatId,
    topicId: surface.provider.topicId,
    isForum: surface.provider.isForum,
    botId,
  });
  if (!routeInfo.route) {
    throw new Error(`Route not configured or not admitted for Telegram target \`${params.target}\`.`);
  }
  const route = routeInfo.route;
  const conversationKind: "dm" | "group" | "topic" =
    routeInfo.conversationKind === "topic"
      ? "topic"
      : routeInfo.conversationKind === "dm"
        ? "dm"
        : "group";
  const sessionTarget = resolveTelegramConversationTarget({
    loadedConfig: params.loadedConfig,
    agentId: route.agentId,
    botId,
    chatId: surface.provider.chatId,
    userId: surface.provider.chatId > 0 ? surface.provider.chatId : undefined,
    conversationKind,
    topicId: surface.provider.topicId,
  });
  const identity = {
    platform: "telegram" as const,
    botId,
    conversationKind,
    chatId: String(surface.provider.chatId),
    topicId:
      typeof surface.provider.topicId === "number" ? String(surface.provider.topicId) : undefined,
  };
  const botConfig = resolveTelegramBotConfig(params.loadedConfig.raw.bots.telegram, botId);
  const cliTool = getAgentEntry(params.loadedConfig, sessionTarget.agentId)?.cli;

  return {
    channel: "telegram",
    botId,
    target: String(surface.provider.chatId),
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

function resolveTelegramSurfaceNotifications(identity: ChannelIdentity, loadedConfig: LoadedConfig) {
  const botId = resolveTelegramBotId(
    loadedConfig.raw.bots.telegram,
    resolveChannelIdentityBotId(identity),
  );
  const channelConfig = resolveTelegramBotConfig(loadedConfig.raw.bots.telegram, botId);
  let resolved = {
    queueStart: channelConfig.surfaceNotifications?.queueStart ?? "brief",
    loopStart: channelConfig.surfaceNotifications?.loopStart ?? "brief",
  };
  if (identity.conversationKind === "dm") {
    return {
      ...resolved,
      ...(resolveTelegramDirectMessageConfig(
        channelConfig,
        identity.senderId,
      )?.surfaceNotifications ?? {}),
    };
  }
  const groupRoute = identity.chatId
    ? channelConfig.groups[identity.chatId] ?? resolveSharedGroupsWildcardRoute(channelConfig.groups)
    : undefined;
  resolved = {
    ...resolved,
    ...(groupRoute?.surfaceNotifications ?? {}),
  };
  if (identity.conversationKind === "topic" && identity.topicId) {
    return {
      ...resolved,
      ...(groupRoute?.topics?.[identity.topicId]?.surfaceNotifications ?? {}),
    };
  }
  return resolved;
}

function resolveTelegramConfiguredMode(
  loadedConfig: LoadedConfig,
  identity: ChannelIdentity,
  key: "responseMode",
): ResponseMode | undefined;
function resolveTelegramConfiguredMode(
  loadedConfig: LoadedConfig,
  identity: ChannelIdentity,
  key: "streaming",
): StreamingMode | undefined;
function resolveTelegramConfiguredMode(
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

export function resolveTelegramBoundSurfaceRuntimeContext(params: {
  loadedConfig: LoadedConfig;
  identity: ChannelIdentity;
}): ChannelBoundSurfaceRuntimeContext | null {
  const botId = resolveTelegramBotId(
    params.loadedConfig.raw.bots.telegram,
    resolveChannelIdentityBotId(params.identity),
  );
  const identity = {
    ...params.identity,
    botId,
  };
  const channelConfig = resolveTelegramBotConfig(params.loadedConfig.raw.bots.telegram, botId);
  const directMessageConfig = identity.conversationKind === "dm"
    ? resolveTelegramDirectMessageConfig(
      channelConfig,
      identity.senderId,
    )
    : undefined;

  return {
    identity,
    promptConfig: channelConfig.agentPrompt,
    responseMode:
      resolveTelegramConfiguredMode(params.loadedConfig, identity, "responseMode") ??
      directMessageConfig?.responseMode ??
      channelConfig.responseMode,
    streaming:
      resolveTelegramConfiguredMode(params.loadedConfig, identity, "streaming") ??
      directMessageConfig?.streaming ??
      channelConfig.streaming,
    surfaceNotifications: resolveTelegramSurfaceNotifications(identity, params.loadedConfig),
  };
}

function normalizeTelegramControlTarget(
  rawTarget: string,
  childSurface?: MessageChildSurfaceSelector,
) {
  const target = rawTarget.trim();
  if (target.startsWith("group:")) {
    return {
      chatId: target.slice("group:".length),
      childSurface,
    };
  }
  if (target.startsWith("topic:")) {
    const [, chatId, topicId] = target.split(":");
    return {
      chatId,
      childSurface: childSurface ?? (topicId
        ? {
            kind: "topic" as const,
            providerId: topicId,
          }
        : undefined),
    };
  }
  return {
    chatId: target,
    childSurface,
  };
}
