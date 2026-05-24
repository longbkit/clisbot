import type { AgentSessionTarget } from "../../agents/runtime/agent-service.ts";
import type { ChannelPlugin } from "../integration/channel-plugin.ts";
import type {
  ParsedMessageCommand,
  ResolvedMessageSurface,
} from "../message/message-command.ts";
import { getCommandTopicId } from "../message/message-surface-helpers.ts";
import {
  listTelegramBots,
  resolveTelegramBotCredentials,
  type TelegramBotCredentialConfig,
} from "./config.ts";
import { TelegramPollingService } from "./service.ts";
import { deleteTelegramMessageAction, editTelegramMessage, listTelegramPins, pinTelegramMessage, reactTelegramMessage, sendTelegramMessage, sendTelegramPoll, unpinTelegramMessage, unsupportedTelegramHistoryAction } from "./message-actions.ts";
import { resolveTelegramConversationRoute } from "./route-config.ts";
import { resolveTelegramConversationTarget } from "./session-routing.ts";
import {
  resolveTelegramBoundSurfaceRuntimeContext,
  resolveTelegramControlSurfaceContext,
} from "./control-surface.ts";
import { buildTelegramPromptSurface, resolveTelegramSurface } from "./surface.ts";
import { describeTelegramStartupFailure } from "./startup-failure.ts";
import { renderCliCommand } from "../../control/commands/cli-name.ts";
import { normalizeChannelUserId } from "../integration/channel-surface-contract-registry.ts";
import { renderMarkdownReplyStyleHint } from "../message/agent-reply.ts";
import { telegramChannelOperatorInventory } from "./operator-inventory.ts";

function resolveTelegramReplyTarget(params: {
  loadedConfig: Parameters<ChannelPlugin["resolveMessageReplyTarget"]>[0]["loadedConfig"];
  command: ParsedMessageCommand;
  surface: ResolvedMessageSurface | null;
  botId: string;
}): AgentSessionTarget | null {
  const surface = resolveTelegramSurface({
    rawTarget: params.command.target,
    childSurface: params.command.childSurface,
    surface: params.surface?.channel === "telegram" ? params.surface : null,
  });
  if (!surface) {
    return null;
  }
  const resolved = resolveTelegramConversationRoute({
    loadedConfig: params.loadedConfig,
    chatType: surface.provider.chatType,
    chatId: surface.provider.chatId,
    topicId: surface.provider.topicId,
    isForum: surface.provider.isForum,
    botId: params.botId,
  });
  if (!resolved.route) {
    return null;
  }

  return resolveTelegramConversationTarget({
    loadedConfig: params.loadedConfig,
    agentId: resolved.route.agentId,
    botId: params.botId,
    chatId: surface.provider.chatId,
    userId: surface.provider.chatId > 0 ? surface.provider.chatId : undefined,
    conversationKind:
      resolved.conversationKind === "topic"
        ? "topic"
        : resolved.conversationKind === "dm"
          ? "dm"
          : "group",
    topicId: surface.provider.topicId,
  });
}

export const telegramChannelPlugin: ChannelPlugin = {
  id: "telegram",
  displayName: "Telegram",
  operatorInventory: telegramChannelOperatorInventory,
  interactionRenderer: "plain",
  senderPrincipalExample: "telegram:1276408333",
  buildDefaultDirectMessageTarget: (providerUserId) =>
    normalizeChannelUserId("telegram", providerUserId),
  childSurfaceCli: {
    kind: "topic",
    primaryFlag: "--topic-id",
    aliasFlags: ["--thread-id"],
  },
  agentReply: {
    inputFormat: "md",
    renderMode: "native",
    styleHint: renderMarkdownReplyStyleHint(
      "Keep the Markdown body under 3000 chars.",
    ),
    resolveTarget: (identity) => identity.chatId ?? null,
    resolveChildSurface: (identity) =>
      identity.topicId
        ? {
            flag: "--topic-id",
            value: identity.topicId,
          }
        : null,
  },
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
  },
  bootstrapCli: {
    accountFlag: "--telegram-account",
    tokenFlags: [
      { flag: "--telegram-bot-token", field: "botToken" },
    ],
    usageLine:
      "[--telegram-account <id> --telegram-bot-token <ENV_NAME|${ENV_NAME}|literal>]...",
    renderExampleCommands: (commandName) => [
      renderCliCommand(
        `${commandName} --cli codex --bot-type personal --telegram-bot-token TELEGRAM_BOT_TOKEN`,
      ),
      renderCliCommand(
        `${commandName} --cli gemini --bot-type personal --telegram-bot-token \"$TELEGRAM_BOT_TOKEN\" --persist`,
      ),
    ],
  },
  get operatorGuidance() {
    return {
      dmFirstLine: "DM the Telegram bot first to confirm it responds normally",
      pairingCodeLine:
        "Send a direct message (DM) to the Telegram bot. Send `/start` or `hi` to receive a pairing code.",
      onboardingLine:
        "Telegram: send `/start` in the target DM, group, or topic to get onboarding or pairing guidance",
      setupMissingLine: "telegram: no explicit group or topic routes are configured yet",
      addRouteLines: [
        `add group: ${renderCliCommand("routes add --channel telegram group:<chatId> --bot default", { inline: true })}`,
        `add topic: ${renderCliCommand("routes add --channel telegram topic:<chatId>:<topicId> --bot default", { inline: true })}`,
      ],
      overrideLine:
        `optional agent override if that surface should use a different agent than the one currently assigned to that bot by default: ${renderCliCommand("routes set-agent --channel telegram group:<chatId> --bot default --agent <id>", { inline: true })} or ${renderCliCommand("routes set-agent --channel telegram topic:<chatId>:<topicId> --bot default --agent <id>", { inline: true })}`,
    };
  },
  get controlHelp() {
    return {
      message: {
        targetLines: [
          "Telegram `--target` is the numeric chat id",
          "  `--topic-id <id>` is a Telegram topic id",
        ],
        renderLines: [
          "  - Telegram native: Markdown/plain -> safe HTML",
          "  - Telegram none: use with --input html",
          "  - html: Telegram only",
        ],
        lengthGuidanceLines: [
          "  Telegram native/html         Final payload must stay under 4096 chars; leave headroom after HTML-safe rendering",
        ],
        exampleLines: [
          `  ${renderCliCommand("message send --channel telegram --target -1001234567890 --topic-id 42 --message \"## Status\"")}`,
          `  ${renderCliCommand("message send --channel telegram --target -1001234567890 --topic-id 42 --input html --render none --message \"<b>Status</b>\"")}`,
        ],
      },
      routes: {
        addSyntaxLines: [
          `  ${renderCliCommand("routes add --channel telegram <group:<chatId>|topic:<chatId>:<topicId>> [--bot <id>] [--policy <...>] [--require-mention <true|false>] [--allow-bots <true|false>]")}`,
        ],
        exampleLines: [
          `  ${renderCliCommand("routes add --channel telegram group:-1001234567890 --bot alerts --require-mention false --allow-bots true --policy allowlist")}`,
          `  ${renderCliCommand("routes add-allow-user --channel telegram group:* --bot alerts --user 1276408333")}`,
          `  ${renderCliCommand("routes add-block-user --channel telegram group:* --bot default --user 1276408333")}`,
          `  ${renderCliCommand("routes add-block-user --channel telegram dm:* --bot alerts --user 1276408333")}`,
          `  ${renderCliCommand("routes add-block-user --channel telegram group:-1001234567890 --bot default --user 1276408333")}`,
          `  ${renderCliCommand("routes set-timezone --channel telegram group:-1001234567890 --bot default Asia/Ho_Chi_Minh")}`,
        ],
      },
    };
  },
  describeStartupFailure: describeTelegramStartupFailure,
  isEnabled: (loadedConfig) => loadedConfig.raw.bots.telegram.defaults.enabled,
  listBots: (loadedConfig) =>
    listTelegramBots(loadedConfig.raw.bots.telegram).map(({ botId, config }) => ({
      botId,
      config,
    })),
  createRuntimeService: (context, bot) =>
    new TelegramPollingService(
      context.loadedConfig,
      context.agentService,
      context.processedEventsStore,
      context.activityStore,
      bot.botId,
      bot.config as TelegramBotCredentialConfig,
      context.reportLifecycle,
    ),
  renderHealthSummary: (state) => {
    switch (state) {
      case "starting":
        return "Telegram channel is starting.";
      case "disabled":
        return "Telegram channel is disabled in config.";
      case "stopped":
        return "Telegram channel is stopped.";
    }
  },
  renderActiveHealthSummary: (serviceCount) =>
    `Telegram polling connected for ${serviceCount} bot(s).`,
  buildPromptSurface: buildTelegramPromptSurface,
  runMessageCommand: async (loadedConfig, command, surface) => {
    const bot = resolveTelegramBotCredentials(
      loadedConfig.raw.bots.telegram,
      command.account,
    );
    const resolvedSurface = resolveTelegramSurface({
      rawTarget: command.target,
      childSurface: command.childSurface,
      surface: surface?.channel === "telegram" ? surface : null,
    });
    const shared = {
      botToken: bot.config.botToken,
      target: resolvedSurface?.rawTarget ?? command.target!,
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
    };

    switch (command.action) {
      case "send":
        return { botId: bot.botId, result: await sendTelegramMessage(shared) };
      case "poll":
        return { botId: bot.botId, result: await sendTelegramPoll(shared) };
      case "react":
        return { botId: bot.botId, result: await reactTelegramMessage(shared) };
      case "reactions":
        return {
          botId: bot.botId,
          result: await unsupportedTelegramHistoryAction("reactions"),
        };
      case "read":
        return {
          botId: bot.botId,
          result: await unsupportedTelegramHistoryAction("read"),
        };
      case "edit":
        return { botId: bot.botId, result: await editTelegramMessage(shared) };
      case "delete":
        return {
          botId: bot.botId,
          result: await deleteTelegramMessageAction(shared),
        };
      case "pin":
        return { botId: bot.botId, result: await pinTelegramMessage(shared) };
      case "unpin":
        return { botId: bot.botId, result: await unpinTelegramMessage(shared) };
      case "pins":
        return { botId: bot.botId, result: await listTelegramPins(shared) };
      case "search":
        return {
          botId: bot.botId,
          result: await unsupportedTelegramHistoryAction("search"),
        };
    }
  },
  resolveMessageSurface: (command) =>
    resolveTelegramSurface({
      rawTarget: command.target,
      childSurface: command.childSurface,
    }),
  resolveMessageReplyTarget: resolveTelegramReplyTarget,
  resolveControlSurfaceContext: (params) => resolveTelegramControlSurfaceContext(params),
  resolveBoundSurfaceRuntimeContext: (params) => resolveTelegramBoundSurfaceRuntimeContext(params),
  renderControlTargetingHelpLines: () => [
    "  - Telegram `--target` accepts `group:<chat-id>`, `topic:<chat-id>:<topic-id>`, or a raw numeric chat id",
    "  - use `--topic-id` for a Telegram topic id",
    "  - omitting `--topic-id` targets the parent Telegram chat",
    "  - in Telegram forum groups, omitting `--topic-id` sends without `message_thread_id`, which means the General topic when that forum has one",
    "  - `--sender <principal>` should use `telegram:<user-id>`",
  ],
  renderLoopExampleLines: ({ command }) =>
    command === "create"
      ? [
          `  ${renderCliCommand("loops create --channel telegram --target group:-1001234567890 --topic-id 42 --sender telegram:1276408333 every weekday at 07:00 standup")}`,
          `  ${renderCliCommand("loops create --channel telegram --target group:-1001234567890 --sender telegram:1276408333 --timezone America/Los_Angeles every day at 07:00 check tickets")}`,
        ]
      : [
          `  ${renderCliCommand("loops list --channel telegram --target group:-1001234567890 --topic-id 42")}`,
          `  ${renderCliCommand("loops status --channel telegram --target group:-1001234567890 --topic-id 42")}`,
          `  ${renderCliCommand("loops --channel telegram --target group:-1001234567890 --topic-id 42 --sender telegram:1276408333 5m")}`,
          `  ${renderCliCommand("loops cancel --channel telegram --target group:-1001234567890 --topic-id 42 --all")}`,
        ],
  renderQueueExampleLines: () => [
    `  ${renderCliCommand("queues create --channel telegram --target group:-1001234567890 --topic-id 4335 --sender telegram:1276408333 review backlog")}`,
  ],
};

export default telegramChannelPlugin;
