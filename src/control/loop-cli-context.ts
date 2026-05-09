import type { AgentSessionTarget } from "../agents/agent-service.ts";
import { getAgentEntry, type LoadedConfig } from "../config/load-config.ts";
import {
  resolveSlackBotConfig,
  resolveSlackBotId,
  resolveTelegramBotConfig,
  resolveTelegramBotId,
  resolveZaloBotConfig,
  resolveZaloBotId,
} from "../config/channel-bots.ts";
import { buildAgentPromptText } from "../channels/agent-prompt.ts";
import { resolveConfigTimezone } from "../config/timezone.ts";
import type { ChannelIdentity } from "../channels/channel-identity.ts";
import type { SurfaceRoute } from "../channels/route-policy.ts";
import { resolveSlackConversationRoute } from "../channels/slack/route-config.ts";
import { resolveSlackConversationTarget } from "../channels/slack/session-routing.ts";
import { normalizeSlackSurfaceTarget } from "../channels/slack/target-normalization.ts";
import { resolveTelegramConversationRoute } from "../channels/telegram/route-config.ts";
import { resolveTelegramConversationTarget } from "../channels/telegram/session-routing.ts";
import { resolveZaloBotConversationRoute } from "../channels/zalo-bot/route-config.ts";
import { resolveZaloBotConversationTarget } from "../channels/zalo-bot/session-routing.ts";
import { renderSlackTargetUsageError } from "../config/route-contract.ts";

type LoopCliChannel = "slack" | "telegram" | "zalo-bot";

export type LoopCliContext = {
  channel: LoopCliChannel;
  botId: string;
  target: string;
  threadId?: string;
  sessionTarget: AgentSessionTarget;
  identity: ChannelIdentity;
  route: SurfaceRoute;
  buildLoopPromptText: (
    text: string,
    options?: {
      maxProgressMessagesOverride?: number;
    },
  ) => string;
};

type LoopCliContextParams = {
  loadedConfig: LoadedConfig;
  channel: LoopCliChannel;
  target: string;
  threadId?: string;
  topicId?: string;
  botId?: string;
};

export type SlackLoopTarget = {
  conversationKind: "dm" | "group" | "channel";
  channelType: "im" | "mpim" | "channel";
  channelId: string;
  userId?: string;
};

export function normalizeSlackLoopTarget(raw: string): SlackLoopTarget {
  try {
    return normalizeSlackSurfaceTarget(raw);
  } catch {
    throw new Error(renderSlackTargetUsageError("loop targets"));
  }
}

function resolveSlackLoopCliContext(params: LoopCliContextParams): LoopCliContext {
  const botId = resolveSlackBotId(params.loadedConfig.raw.bots.slack, params.botId);
  const target = normalizeSlackLoopTarget(params.target);
  const routeInfo = resolveSlackConversationRoute(
    params.loadedConfig,
    {
      channel_type: target.channelType,
      channel: target.channelId,
      user: target.userId,
    },
    {
      botId,
    },
  );
  if (!routeInfo.route) {
    throw new Error(`Route not configured or not admitted for Slack target \`${params.target}\`.`);
  }
  const route = routeInfo.route;

  const sessionTarget = resolveSlackConversationTarget({
    loadedConfig: params.loadedConfig,
    agentId: route.agentId,
    botId,
    channelId: target.channelId,
    userId: target.userId,
    conversationKind: target.conversationKind,
    threadTs: params.threadId,
    messageTs: params.threadId,
    replyToMode: routeInfo.route.replyToMode,
  });
  const identity: ChannelIdentity = {
    platform: "slack",
    botId,
    conversationKind: target.conversationKind,
    channelId: target.channelId,
    threadTs: params.threadId?.trim() || undefined,
  };
  const botConfig = resolveSlackBotConfig(params.loadedConfig.raw.bots.slack, botId);
  const cliTool = getAgentEntry(params.loadedConfig, sessionTarget.agentId)?.cli;

  return {
    channel: "slack",
    botId,
    target: params.target,
    threadId: params.threadId?.trim() || undefined,
    sessionTarget,
    identity,
    route,
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

function resolveTelegramLoopCliContext(params: LoopCliContextParams): LoopCliContext {
  const target = normalizeTelegramLoopTarget(params.target, params.topicId ?? params.threadId);
  const chatId = Number(target.chatId);
  if (!Number.isFinite(chatId)) {
    throw new Error("Telegram loop targets must use `group:<chat-id>`, `topic:<chat-id>:<topic-id>`, or a numeric chat id.");
  }

  const rawThreadId = params.threadId?.trim();
  const rawTopicId = target.topicId ?? params.topicId?.trim() ?? rawThreadId;
  const topicId = rawTopicId ? Number(rawTopicId) : undefined;
  if (rawTopicId && !Number.isFinite(topicId)) {
    throw new Error("Telegram --topic-id must be a numeric topic id.");
  }

  const botId = resolveTelegramBotId(params.loadedConfig.raw.bots.telegram, params.botId);
  const routeInfo = resolveTelegramConversationRoute({
    loadedConfig: params.loadedConfig,
    chatType: chatId > 0 ? "private" : "supergroup",
    chatId,
    topicId: Number.isFinite(topicId) ? topicId : undefined,
    isForum: Number.isFinite(topicId),
    botId,
  });
  if (!routeInfo.route) {
    throw new Error(`Route not configured or not admitted for Telegram target \`${params.target}\`.`);
  }
  const route = routeInfo.route;

  const conversationKind =
    routeInfo.conversationKind === "topic"
      ? "topic"
      : routeInfo.conversationKind === "dm"
        ? "dm"
        : "group";
  const sessionTarget = resolveTelegramConversationTarget({
    loadedConfig: params.loadedConfig,
    agentId: route.agentId,
    botId,
    chatId,
    userId: chatId > 0 ? chatId : undefined,
    conversationKind,
    topicId: Number.isFinite(topicId) ? topicId : undefined,
  });
  const identity: ChannelIdentity = {
    platform: "telegram",
    botId,
    conversationKind,
    chatId: String(chatId),
    topicId: Number.isFinite(topicId) ? String(topicId) : undefined,
  };
  const botConfig = resolveTelegramBotConfig(params.loadedConfig.raw.bots.telegram, botId);
  const cliTool = getAgentEntry(params.loadedConfig, sessionTarget.agentId)?.cli;

  return {
    channel: "telegram",
    botId,
    target: target.chatId,
    threadId: Number.isFinite(topicId) ? String(topicId) : undefined,
    sessionTarget,
    identity,
    route,
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

function normalizeZaloBotLoopTarget(rawTarget: string) {
  const target = rawTarget.trim();
  if (target.startsWith("dm:")) {
    const chatId = target.slice("dm:".length).trim();
    return {
      chatType: "PRIVATE" as const,
      chatId,
      userId: chatId,
      conversationKind: "dm" as const,
    };
  }
  if (target.startsWith("group:")) {
    return {
      chatType: "GROUP" as const,
      chatId: target.slice("group:".length).trim(),
      userId: undefined,
      conversationKind: "group" as const,
    };
  }
  throw new Error("Zalo Bot loop targets must use `dm:<user-id>` or `group:<chat-id>`.");
}

function resolveZaloBotLoopCliContext(params: LoopCliContextParams): LoopCliContext {
  const target = normalizeZaloBotLoopTarget(params.target);
  const botId = resolveZaloBotId(params.loadedConfig.raw.bots.zaloBot, params.botId);
  const routeInfo = resolveZaloBotConversationRoute({
    loadedConfig: params.loadedConfig,
    chatType: target.chatType,
    chatId: target.chatId,
    senderId: target.userId ?? target.chatId,
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
    chatId: target.chatId,
    userId: target.userId,
    conversationKind: routeInfo.conversationKind,
  });
  const identity: ChannelIdentity = {
    platform: "zalo-bot",
    botId,
    conversationKind: routeInfo.conversationKind,
    chatId: target.chatId,
  };
  const botConfig = resolveZaloBotConfig(params.loadedConfig.raw.bots.zaloBot, botId);
  const cliTool = getAgentEntry(params.loadedConfig, sessionTarget.agentId)?.cli;

  return {
    channel: "zalo-bot",
    botId,
    target: params.target,
    sessionTarget,
    identity,
    route,
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

function normalizeTelegramLoopTarget(rawTarget: string, explicitTopicId?: string) {
  const target = rawTarget.trim();
  if (target.startsWith("group:")) {
    return {
      chatId: target.slice("group:".length),
      topicId: explicitTopicId,
    };
  }
  if (target.startsWith("topic:")) {
    const [, chatId, topicId] = target.split(":");
    return {
      chatId,
      topicId: explicitTopicId ?? topicId,
    };
  }
  return {
    chatId: target,
    topicId: explicitTopicId,
  };
}

export function resolveLoopCliContext(params: LoopCliContextParams): LoopCliContext {
  if (params.channel === "slack") {
    return resolveSlackLoopCliContext(params);
  }
  if (params.channel === "zalo-bot") {
    return resolveZaloBotLoopCliContext(params);
  }
  return resolveTelegramLoopCliContext(params);
}
