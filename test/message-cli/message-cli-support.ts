import { resolveSlackConversationRoute } from "../../src/channels/slack/route-config.ts";
import { resolveSlackConversationTarget } from "../../src/channels/slack/session-routing.ts";
import { resolveTelegramConversationRoute } from "../../src/channels/telegram/route-config.ts";
import { resolveTelegramConversationTarget } from "../../src/channels/telegram/session-routing.ts";
import { resolveZaloBotConversationRoute } from "../../src/channels/zalo-bot/route-config.ts";
import { resolveZaloBotConversationTarget } from "../../src/channels/zalo-bot/session-routing.ts";
import type { ChannelPlugin } from "../../src/channels/integration/channel-plugin.ts";
import type { ParsedMessageCommand } from "../../src/channels/message/message-command.ts";
import { getCommandThreadId, getCommandTopicId } from "../../src/channels/message/message-surface-helpers.ts";
import type { LoadConfigOptions, LoadedConfig } from "../../src/config/core/load-config.ts";
import { clisbotConfigSchema } from "../../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";

let previousCliName: string | undefined;

export function createRawConfig(): LoadedConfig["raw"] {
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  config.app.session.storePath = "/tmp/sessions.json";
  config.agents.defaults.workspace = "/tmp/{agentId}";
  config.agents.defaults.runner.defaults.tmux.socketPath = "/tmp/clisbot.sock";
  config.agents.defaults.runner.defaults.startupDelayMs = 1;
  config.agents.defaults.runner.defaults.startupRetryCount = 2;
  config.agents.defaults.runner.defaults.startupRetryDelayMs = 0;
  config.agents.defaults.runner.defaults.promptSubmitDelayMs = 1;
  config.agents.defaults.runner.codex.sessionId!.capture = {
    mode: "off",
    statusCommand: "/status",
    pattern: "id",
    timeoutMs: 1,
    pollIntervalMs: 1,
  };
  config.agents.defaults.runner.defaults.stream.captureLines = 10;
  config.agents.defaults.runner.defaults.stream.updateIntervalMs = 10;
  config.agents.defaults.runner.defaults.stream.idleTimeoutMs = 10;
  config.agents.defaults.runner.defaults.stream.noOutputTimeoutMs = 10;
  config.agents.defaults.runner.defaults.stream.maxRuntimeSec = 10;
  config.agents.defaults.runner.defaults.stream.maxRuntimeMin = undefined;
  config.agents.defaults.runner.defaults.stream.maxMessageChars = 100;
  config.agents.list = [{ id: "default" }];
  config.app.control.configReload.watch = false;
  config.bots.slack.defaults.enabled = true;
  config.bots.slack.defaults.defaultBotId = "work";
  config.bots.slack.work = {
    ...config.bots.slack.default,
    enabled: true,
    name: "work",
    groups: {
      C123: {
        enabled: true,
        policy: "open",
        requireMention: true,
        allowBots: false,
        allowUsers: [],
        blockUsers: [],
      },
    },
  };
  config.bots.slack.alerts = {
    ...config.bots.slack.default,
    enabled: true,
    name: "alerts",
    groups: {
      C123: {
        enabled: true,
        policy: "open",
        requireMention: true,
        allowBots: false,
        allowUsers: [],
        blockUsers: [],
      },
    },
  };
  delete config.bots.slack.default;
  config.bots.telegram.defaults.enabled = true;
  config.bots.telegram.defaults.defaultBotId = "ops";
  config.bots.telegram.ops = {
    ...config.bots.telegram.default,
    enabled: true,
    name: "ops",
    groups: {
      "-1001234567890": {
        enabled: true,
        policy: "open",
        requireMention: false,
        allowBots: false,
        allowUsers: [],
        blockUsers: [],
        topics: {},
      },
    },
  };
  delete config.bots.telegram.default;
  config.bots.zaloBot.defaults.enabled = true;
  config.bots.zaloBot.defaults.defaultBotId = "default";
  config.bots.zaloBot.default = {
    ...config.bots.zaloBot.default,
    enabled: true,
    name: "default",
    directMessages: {},
    groups: {
      "group-1": {
        enabled: true,
        policy: "open",
        requireMention: true,
        allowBots: false,
        allowUsers: [],
        blockUsers: [],
      },
    },
  };
  return {
    ...config,
    session: {
      ...config.app.session,
      dmScope: config.bots.defaults.dmScope,
    },
    control: config.app.control,
    tmux: config.agents.defaults.runner.defaults.tmux,
  };
}

export function normalizeSlackFollowUpTarget(rawTarget: string) {
  const target = rawTarget.trim();
  if (!target) {
    return null;
  }

  if (target.startsWith("channel:")) {
    return {
      conversationKind: "channel" as const,
      channelId: target.slice("channel:".length),
      channelType: "channel" as const,
    };
  }

  if (target.startsWith("group:")) {
    const channelId = target.slice("group:".length);
    return {
      conversationKind: channelId.startsWith("G") ? ("group" as const) : ("channel" as const),
      channelId,
      channelType: channelId.startsWith("G") ? ("mpim" as const) : ("channel" as const),
    };
  }

  if (target.startsWith("dm:")) {
    return {
      conversationKind: "dm" as const,
      channelId: target.slice("dm:".length),
      channelType: "im" as const,
    };
  }

  if (target.startsWith("D")) {
    return {
      conversationKind: "dm" as const,
      channelId: target,
      channelType: "im" as const,
    };
  }

  if (target.startsWith("G")) {
    return {
      conversationKind: "group" as const,
      channelId: target,
      channelType: "mpim" as const,
    };
  }

  if (target.startsWith("C")) {
    return {
      conversationKind: "channel" as const,
      channelId: target,
      channelType: "channel" as const,
    };
  }

  return null;
}

export function createDependencies() {
  const logs: string[] = [];
  const calls: Array<{ provider: string; action: string; params: unknown }> = [];
  const replyTargets: Array<{
    loadedConfig: LoadedConfig;
    target: unknown;
    kind?: string;
    source?: string;
  }> = [];
  const loadedConfig: LoadedConfig = {
    configPath: "/tmp/clisbot.json",
    processedEventsPath: "/tmp/processed-events.json",
    stateDir: "/tmp/clisbot-state",
    raw: createRawConfig(),
  };

  const deps = {
    loadConfig: async (_configPath?: string, _options?: LoadConfigOptions) => loadedConfig,
    plugins: [
      {
        id: "slack",
        capabilities: {
          surfaceKinds: ["dm", "group"],
          messageActions: [
            "send",
            "poll",
            "react",
            "reactions",
            "read",
            "edit",
            "delete",
            "pin",
            "unpin",
            "pins",
            "search",
          ],
          supportsMessageCustomSubtree: false,
        },
        isEnabled: () => true,
        listBots: () => [],
        createRuntimeService: () => {
          throw new Error("not used in message cli tests");
        },
        renderHealthSummary: () => "unused",
        renderActiveHealthSummary: () => "unused",
        runMessageCommand: async (_loadedConfig: any, command: ParsedMessageCommand) => {
          const params = {
            botToken: "xoxb-test",
            target: command.target!,
            threadId: getCommandThreadId(command),
            replyTo: command.replyTo,
            message: command.message,
            media: command.media,
            messageId: command.messageId,
            emoji: command.emoji,
            remove: command.remove,
            limit: command.limit,
            query: command.query,
          pollQuestion: command.pollQuestion,
          pollOptions: command.pollOptions,
          inputFormat: command.inputFormat,
          renderMode: command.renderMode,
          progress: command.progress,
          final: command.final,
          };
          calls.push({ provider: "slack", action: command.action, params });
          return {
            botId: command.account ?? "work",
            result:
              command.action === "send"
                ? { ok: true, provider: "slack", action: "send" }
                : { ok: true },
          };
        },
        resolveMessageReplyTarget: ({ loadedConfig, command, botId, surface }) => {
          if (!command.target) {
            return null;
          }
          const normalizedTarget =
            surface?.channel === "slack" ? surface.provider : normalizeSlackFollowUpTarget(command.target);
          if (!normalizedTarget) {
            return null;
          }
          const resolved = resolveSlackConversationRoute(
            loadedConfig,
            {
              channel_type: normalizedTarget.channelType,
              channel: normalizedTarget.channelId,
            },
            { botId },
          );
          if (!resolved.route) {
            return null;
          }
          return resolveSlackConversationTarget({
            loadedConfig,
            agentId: resolved.route.agentId,
            botId,
            channelId: normalizedTarget.channelId,
            conversationKind: normalizedTarget.conversationKind,
            threadTs: getCommandThreadId(command) ?? command.replyTo,
            messageTs: command.replyTo ?? getCommandThreadId(command),
            replyToMode: resolved.route.replyToMode,
          });
        },
        resolveMessageSurface: (command) => {
          if (!command.target) {
            return null;
          }
          const normalizedTarget = normalizeSlackFollowUpTarget(command.target);
          if (!normalizedTarget) {
            return null;
          }
          const threadId = getCommandThreadId(command);
          const baseSurfaceId = `slack:${normalizedTarget.conversationKind}:${normalizedTarget.channelId}`;
          return {
            channel: "slack" as const,
            rawTarget: command.target,
            surfaceKind: normalizedTarget.conversationKind === "dm" ? "dm" : "group",
            surfaceId:
              !threadId || !baseSurfaceId ? baseSurfaceId : `${baseSurfaceId}:thread:${threadId}`,
            parentSurfaceId: threadId ? baseSurfaceId : undefined,
            childSurface: threadId ? { kind: "thread" as const, providerId: threadId } : undefined,
            provider: normalizedTarget,
          };
        },
      },
      {
        id: "telegram",
        capabilities: {
          surfaceKinds: ["dm", "group", "topic"],
          messageActions: [
            "send",
            "poll",
            "react",
            "edit",
            "delete",
            "pin",
            "unpin",
            "pins",
          ],
          supportsMessageCustomSubtree: false,
        },
        isEnabled: () => true,
        listBots: () => [],
        createRuntimeService: () => {
          throw new Error("not used in message cli tests");
        },
        renderHealthSummary: () => "unused",
        renderActiveHealthSummary: () => "unused",
        runMessageCommand: async (_loadedConfig: any, command: ParsedMessageCommand) => {
          const params =
            command.action === "read" || command.action === "reactions" || command.action === "search"
              ? command.action
              : {
                  botToken: "telegram-test",
                  target: command.target!,
                  threadId: getCommandTopicId(command),
                  replyTo: command.replyTo,
                  message: command.message,
                  media: command.media,
                  messageId: command.messageId,
                  emoji: command.emoji,
                  remove: command.remove,
                  limit: command.limit,
                  query: command.query,
                  pollQuestion: command.pollQuestion,
                  pollOptions: command.pollOptions,
                  forceDocument: command.forceDocument,
                  silent: command.silent,
                  inputFormat: command.inputFormat,
                  renderMode: command.renderMode,
                  progress: command.progress,
                  final: command.final,
                };
          calls.push({
            provider: "telegram",
            action:
              command.action === "read" || command.action === "reactions" || command.action === "search"
                ? "unsupported"
                : command.action,
            params,
          });
          return {
            botId: command.account ?? "ops",
            result:
              command.action === "read" || command.action === "reactions" || command.action === "search"
                ? { ok: false, action: command.action }
                : command.action === "send"
                  ? { ok: true, provider: "telegram", action: "send" }
                  : { ok: true },
          };
        },
        resolveMessageReplyTarget: ({ loadedConfig, command, botId, surface }) => {
          if (surface?.channel !== "telegram" && !command.target) {
            return null;
          }
          const chatId = surface?.channel === "telegram" ? surface.provider.chatId : Number(command.target);
          if (!Number.isFinite(chatId)) {
            return null;
          }
          const topicId =
            surface?.channel === "telegram"
              ? surface.provider.topicId
              : getCommandTopicId(command)
                ? Number(getCommandTopicId(command))
                : undefined;
          const resolved = resolveTelegramConversationRoute({
            loadedConfig,
            chatType: chatId > 0 ? "private" : "supergroup",
            chatId,
            topicId: Number.isFinite(topicId) ? topicId : undefined,
            isForum: Number.isFinite(topicId),
            botId,
          });
          if (!resolved.route) {
            return null;
          }
          return resolveTelegramConversationTarget({
            loadedConfig,
            agentId: resolved.route.agentId,
            botId,
            chatId,
            userId: chatId > 0 ? chatId : undefined,
            conversationKind:
              resolved.conversationKind === "topic"
                ? "topic"
                : resolved.conversationKind === "dm"
                  ? "dm"
                  : "group",
            topicId: Number.isFinite(topicId) ? topicId : undefined,
          });
        },
        resolveMessageSurface: (command) => {
          if (!command.target) {
            return null;
          }
          const chatId = Number(command.target);
          if (!Number.isFinite(chatId)) {
            return null;
          }
          const topicId = getCommandTopicId(command);
          return {
            channel: "telegram" as const,
            rawTarget: command.target,
            surfaceKind: topicId ? "topic" : chatId > 0 ? "dm" : "group",
            surfaceId: topicId ? `telegram:topic:${chatId}:${topicId}` : `telegram:${chatId > 0 ? "dm" : "group"}:${chatId}`,
            parentSurfaceId: topicId ? `telegram:group:${chatId}` : undefined,
            childSurface: topicId ? { kind: "topic" as const, providerId: topicId } : undefined,
            provider: {
              chatId,
              chatType: chatId > 0 ? "private" as const : "supergroup" as const,
              topicId: topicId ? Number(topicId) : undefined,
              isForum: Boolean(topicId),
            },
          };
        },
      },
      {
        id: "zalo-bot",
        capabilities: {
          surfaceKinds: ["dm"],
          messageActions: ["send"],
          supportsMessageCustomSubtree: false,
        },
        isEnabled: () => true,
        listBots: () => [],
        createRuntimeService: () => {
          throw new Error("not used in message cli tests");
        },
        renderHealthSummary: () => "unused",
        renderActiveHealthSummary: () => "unused",
        runMessageCommand: async (_loadedConfig: any, command: ParsedMessageCommand) => {
          const params =
            command.action === "read" || command.action === "reactions" || command.action === "search"
              ? command.action
              : {
                  botToken: "zalo-bot-test",
                  target: command.target!,
                  threadId: undefined,
                  replyTo: command.replyTo,
                  message: command.message,
                  media: command.media,
                  messageId: command.messageId,
                  emoji: command.emoji,
                  remove: command.remove,
                  limit: command.limit,
                  query: command.query,
                  pollQuestion: command.pollQuestion,
                  pollOptions: command.pollOptions,
                  forceDocument: command.forceDocument,
                  silent: command.silent,
                  inputFormat: command.inputFormat,
                  renderMode: command.renderMode,
                  progress: command.progress,
                  final: command.final,
                };
          calls.push({
            provider: "zalo-bot",
            action:
              command.action === "read" || command.action === "reactions" || command.action === "search"
                ? "unsupported"
                : command.action,
            params,
          });
          return {
            botId: command.account ?? "default",
            result:
              command.action === "read" || command.action === "reactions" || command.action === "search"
                ? { ok: false, action: command.action }
                : command.action === "send"
                  ? { ok: true, provider: "zalo-bot", action: "send" }
                  : { ok: true },
          };
        },
        resolveMessageReplyTarget: ({ loadedConfig, command, botId, surface }) => {
          const rawTarget = surface?.channel === "zalo-bot" ? surface.provider.chatId : command.target;
          if (!rawTarget) {
            return null;
          }
          const chatId = rawTarget.trim();
          if (!chatId) {
            return null;
          }
          const resolved = resolveZaloBotConversationRoute({
            loadedConfig,
            chatType: chatId.startsWith("group") ? "GROUP" : "PRIVATE",
            chatId,
            senderId: chatId.startsWith("group") ? undefined : chatId,
            botId,
          });
          if (!resolved.route) {
            return null;
          }
          return resolveZaloBotConversationTarget({
            loadedConfig,
            agentId: resolved.route.agentId,
            botId,
            chatId,
            userId: resolved.conversationKind === "dm" ? chatId : undefined,
            conversationKind: resolved.conversationKind,
          });
        },
        resolveMessageSurface: (command) => {
          if (!command.target) {
            return null;
          }
          const chatId = command.target.trim();
          const isGroup = chatId.startsWith("group");
          return {
            channel: "zalo-bot" as const,
            rawTarget: command.target,
            surfaceKind: isGroup ? "group" : "dm",
            surfaceId: `zalo-bot:${isGroup ? "group" : "dm"}:${chatId}`,
            provider: {
              chatId,
              chatType: isGroup ? "GROUP" as const : "PRIVATE" as const,
            },
          };
        },
      },
    ] satisfies ChannelPlugin[],
    print: (text: string) => {
      logs.push(text);
    },
    recordConversationReply: async (params: {
      loadedConfig: LoadedConfig;
      target: unknown;
      kind?: string;
      source?: string;
    }) => {
      replyTargets.push(params);
    },
  };

  return { deps, logs, calls, replyTargets };
}
