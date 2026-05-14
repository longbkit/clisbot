import type { LoadedConfig } from "../../config/core/load-config.ts";
import { getAgentEntry } from "../../config/core/load-config.ts";
import {
  resolveSlackBotConfig,
  resolveSlackBotId,
  resolveSlackDirectMessageConfig,
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
  ProvisionedLoopChildSurface,
} from "../integration/channel-plugin.ts";
import type { MessageChildSurfaceSelector } from "../message/message-command.ts";
import {
  resolveConfiguredSurfaceModeTarget,
  buildConfiguredTargetFromIdentity,
  type ResponseMode,
  type StreamingMode,
} from "../config/surface-mode-config.ts";
import { resolveSharedGroupsWildcardRoute } from "../../config/channels/group-routes.ts";
import { resolveSlackConversationRoute } from "./route-config.ts";
import { resolveSlackConversationTarget } from "./session-routing.ts";
import { resolveSlackSurface } from "./surface.ts";

type SlackApiSuccess<T> = T & { ok: true };
type SlackApiFailure = { ok: false; error?: string };

async function callSlackApi<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<SlackApiSuccess<T>> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Slack API ${method} failed with HTTP ${response.status}.`);
  }

  const data = (await response.json()) as SlackApiSuccess<T> | SlackApiFailure;
  if (!data.ok) {
    throw new Error(`Slack API ${method} failed: ${data.error ?? "unknown_error"}`);
  }
  return data;
}

async function resolveSlackPostChannelId(params: {
  loadedConfig: LoadedConfig;
  botId?: string;
  target: string;
}) {
  const surface = resolveSlackSurface({
    rawTarget: params.target,
  });
  if (!surface) {
    throw new Error("Slack loop targets must use a valid Slack target.");
  }
  if (surface.provider.conversationKind !== "dm" || !surface.provider.userId) {
    return surface.provider.channelId;
  }

  const resolvedBotId = resolveSlackBotId(
    params.loadedConfig.raw.bots.slack,
    params.botId,
  );
  const botToken = resolveSlackBotConfig(
    params.loadedConfig.raw.bots.slack,
    resolvedBotId,
  ).botToken.trim();
  if (!botToken) {
    throw new Error("Slack bot credentials are required to resolve the loop target.");
  }

  const opened = await callSlackApi<{ channel?: { id?: string } }>(
    botToken,
    "conversations.open",
    {
      users: surface.provider.userId,
    },
  );
  const channelId = opened.channel?.id?.trim();
  if (!channelId) {
    throw new Error(`Unable to open Slack DM for user ${surface.provider.userId}.`);
  }
  return channelId;
}

export function resolveSlackControlSurfaceContext(params: {
  loadedConfig: LoadedConfig;
  target: string;
  childSurface?: MessageChildSurfaceSelector;
  botId?: string;
}): ChannelControlSurfaceContext | null {
  const surface = resolveSlackSurface({
    rawTarget: params.target,
    childSurface: params.childSurface,
  });
  if (!surface) {
    return null;
  }

  const botId = resolveSlackBotId(params.loadedConfig.raw.bots.slack, params.botId);
  const routeInfo = resolveSlackConversationRoute(
    params.loadedConfig,
    {
      channel_type: surface.provider.channelType,
      channel: surface.provider.channelId,
      user: surface.provider.userId,
    },
    {
      botId,
    },
  );
  if (!routeInfo.route) {
    throw new Error(`Route not configured or not admitted for Slack target \`${params.target}\`.`);
  }
  const route = routeInfo.route;
  const threadTs =
    surface.childSurface?.kind === "thread" ? surface.childSurface.providerId.trim() : undefined;
  const sessionTarget = resolveSlackConversationTarget({
    loadedConfig: params.loadedConfig,
    agentId: route.agentId,
    botId,
    channelId: surface.provider.channelId,
    userId: surface.provider.userId,
    conversationKind: surface.provider.conversationKind,
    threadTs,
    messageTs: threadTs,
    replyToMode: routeInfo.route.replyToMode,
  });
  const identity = {
    platform: "slack" as const,
    botId,
    conversationKind: surface.provider.conversationKind,
    channelId: surface.provider.channelId,
    threadTs,
  };
  const botConfig = resolveSlackBotConfig(params.loadedConfig.raw.bots.slack, botId);
  const cliTool = getAgentEntry(params.loadedConfig, sessionTarget.agentId)?.cli;

  return {
    channel: "slack",
    botId,
    target: params.target,
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

export async function provisionSlackLoopChildSurface(params: {
  loadedConfig: LoadedConfig;
  target: string;
  botId?: string;
  initialText: string;
}): Promise<ProvisionedLoopChildSurface> {
  const resolvedBotId = resolveSlackBotId(
    params.loadedConfig.raw.bots.slack,
    params.botId,
  );
  const botToken = resolveSlackBotConfig(
    params.loadedConfig.raw.bots.slack,
    resolvedBotId,
  ).botToken.trim();
  if (!botToken) {
    throw new Error("Slack bot credentials are required to create a new loop thread.");
  }

  const channelId = await resolveSlackPostChannelId({
    loadedConfig: params.loadedConfig,
    botId: params.botId,
    target: params.target,
  });
  const posted = await callSlackApi<{ ts?: string }>(
    botToken,
    "chat.postMessage",
    {
      channel: channelId,
      text: params.initialText,
    },
  );
  const threadTs = posted.ts?.trim();
  if (!threadTs) {
    throw new Error("Slack did not return a thread timestamp for the new loop thread.");
  }

  return {
    childSurface: {
      kind: "thread",
      providerId: threadTs,
    },
    deliveryTarget: channelId,
  };
}

function resolveSlackSurfaceNotifications(identity: ChannelIdentity, loadedConfig: LoadedConfig) {
  const botId = resolveSlackBotId(
    loadedConfig.raw.bots.slack,
    resolveChannelIdentityBotId(identity),
  );
  const channelConfig = resolveSlackBotConfig(loadedConfig.raw.bots.slack, botId);
  const base = {
    queueStart: channelConfig.surfaceNotifications?.queueStart ?? "brief",
    loopStart: channelConfig.surfaceNotifications?.loopStart ?? "brief",
  } as const;

  if (identity.conversationKind === "dm") {
    return {
      ...base,
      ...(resolveSlackDirectMessageConfig(channelConfig, identity.senderId)?.surfaceNotifications ?? {}),
    };
  }

  const route = identity.channelId
    ? channelConfig.groups[identity.channelId] ?? resolveSharedGroupsWildcardRoute(channelConfig.groups)
    : undefined;
  return {
    ...base,
    ...(route?.surfaceNotifications ?? {}),
  };
}

function resolveSlackConfiguredMode(
  loadedConfig: LoadedConfig,
  identity: ChannelIdentity,
  key: "responseMode",
): ResponseMode | undefined;
function resolveSlackConfiguredMode(
  loadedConfig: LoadedConfig,
  identity: ChannelIdentity,
  key: "streaming",
): StreamingMode | undefined;
function resolveSlackConfiguredMode(
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

export function resolveSlackBoundSurfaceRuntimeContext(params: {
  loadedConfig: LoadedConfig;
  identity: ChannelIdentity;
}): ChannelBoundSurfaceRuntimeContext | null {
  const botId = resolveSlackBotId(
    params.loadedConfig.raw.bots.slack,
    resolveChannelIdentityBotId(params.identity),
  );
  const identity = {
    ...params.identity,
    botId,
  };
  const channelConfig = resolveSlackBotConfig(params.loadedConfig.raw.bots.slack, botId);
  const directMessageConfig = identity.conversationKind === "dm"
    ? resolveSlackDirectMessageConfig(channelConfig, identity.senderId)
    : undefined;
  const fallbackResponseMode = directMessageConfig?.responseMode ?? channelConfig.responseMode;
  const fallbackStreaming = directMessageConfig?.streaming ?? channelConfig.streaming;

  return {
    identity,
    promptConfig: channelConfig.agentPrompt,
    responseMode:
      resolveSlackConfiguredMode(params.loadedConfig, identity, "responseMode") ??
      fallbackResponseMode,
    streaming:
      resolveSlackConfiguredMode(params.loadedConfig, identity, "streaming") ??
      fallbackStreaming,
    surfaceNotifications: resolveSlackSurfaceNotifications(identity, params.loadedConfig),
  };
}
