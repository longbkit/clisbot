import type { AgentSessionTarget } from "../../agents/runtime/agent-service.ts";
import type { ChannelPlugin } from "../integration/channel-plugin.ts";
import type {
  ParsedMessageCommand,
  ResolvedMessageSurface,
} from "../message/message-command.ts";
import {
  listZaloBotBots,
  resolveZaloBotCredentials,
  type ZaloBotCredentialConfig,
} from "./config.ts";
import { ZaloBotPollingService } from "./service.ts";
import {
  sendZaloBotMessageAction,
  unsupportedZaloBotHistoryAction,
} from "./message-actions.ts";
import { resolveZaloBotConversationRoute } from "./route-config.ts";
import { resolveZaloBotConversationTarget } from "./session-routing.ts";
import {
  resolveZaloBotBoundSurfaceRuntimeContext,
  resolveZaloBotControlSurfaceContext,
} from "./control-surface.ts";
import { buildZaloBotPromptSurface, resolveZaloBotSurface } from "./surface.ts";
import { describeZaloBotStartupFailure } from "./startup-failure.ts";
import { renderCliCommand } from "../../control/commands/cli-name.ts";
import { normalizeChannelUserId } from "../integration/channel-surface-contract-registry.ts";
import { renderPlainTextReplyStyleHint } from "../message/agent-reply.ts";
import { zaloBotChannelOperatorInventory } from "./operator-inventory.ts";

function resolveZaloBotReplyTarget(params: {
  loadedConfig: Parameters<ChannelPlugin["resolveMessageReplyTarget"]>[0]["loadedConfig"];
  command: ParsedMessageCommand;
  surface: ResolvedMessageSurface | null;
  botId: string;
}): AgentSessionTarget | null {
  const surface = resolveZaloBotSurface({
    rawTarget: params.command.target,
    childSurface: params.command.childSurface,
    surface: params.surface?.channel === "zalo-bot" ? params.surface : null,
  });
  if (!surface) {
    return null;
  }

  const conversation = resolveZaloBotConversationRoute({
    loadedConfig: params.loadedConfig,
    chatType: surface.provider.chatType,
    chatId: surface.provider.chatId,
    senderId: surface.provider.chatType === "GROUP" ? undefined : surface.provider.chatId,
    botId: params.botId,
  });
  if (!conversation.route) {
    return null;
  }

  return resolveZaloBotConversationTarget({
    loadedConfig: params.loadedConfig,
    agentId: conversation.route.agentId,
    botId: params.botId,
    chatId: surface.provider.chatId,
    userId: conversation.conversationKind === "dm" ? surface.provider.chatId : undefined,
    conversationKind: conversation.conversationKind,
  });
}

export const zaloBotChannelPlugin: ChannelPlugin = {
  id: "zalo-bot",
  displayName: "Zalo Bot",
  operatorInventory: zaloBotChannelOperatorInventory,
  interactionRenderer: "plain",
  senderPrincipalExample: "zalo-bot:user-123",
  buildDefaultDirectMessageTarget: (providerUserId) =>
    normalizeChannelUserId("zalo-bot", providerUserId),
  agentReply: {
    inputFormat: "md",
    renderMode: "native",
    styleHint: [
      "Zalo Bot does not support Markdown rendering.",
      renderPlainTextReplyStyleHint("Keep the message body under 3000 chars."),
    ].join(" "),
    resolveTarget: (identity) => identity.chatId ?? null,
  },
  capabilities: {
    surfaceKinds: ["dm"],
    messageActions: ["send"],
  },
  bootstrapCli: {
    accountFlag: "--zalo-bot-account",
    tokenFlags: [
      { flag: "--zalo-bot-token", field: "botToken" },
    ],
    usageLine:
      "[--zalo-bot-account <id> --zalo-bot-token <ENV_NAME|${ENV_NAME}|literal>]...",
    renderExampleCommands: (commandName) => [
      renderCliCommand(
        `${commandName} --cli codex --bot-type personal --zalo-bot-token ZALO_BOT_TOKEN`,
      ),
    ],
  },
  get operatorGuidance() {
    return {
      dmFirstLine: "DM the Zalo Bot first to confirm it responds normally",
      pairingCodeLine: "Send a direct message (DM) to the Zalo Bot. Send `hi` to receive a pairing code.",
      onboardingLine: "Zalo Bot: DM the bot for pairing flow and queue/loop validation",
      setupMissingLine: "zalo-bot: no explicit DM routes are configured yet",
      addRouteLines: [
        `add DM: ${renderCliCommand("routes add --channel zalo-bot dm:<user-id> --bot default", { inline: true })}`,
      ],
      overrideLine:
        `optional agent override if that route should use a different agent than the one currently assigned to that bot by default: ${renderCliCommand("routes set-agent --channel zalo-bot dm:<user-id> --bot default --agent <id>", { inline: true })}`,
    };
  },
  get controlHelp() {
    return {
      message: {
        targetLines: [
          "Zalo Bot `--target` accepts `dm:<user-id>`; raw ids are treated as DM-compatible send targets",
        ],
        renderLines: [
          "  - Zalo Bot native: Markdown/plain -> readable plain text",
        ],
        exampleLines: [
          `  ${renderCliCommand("message send --channel zalo-bot --target dm:user-123 --message \"Status\"")}`,
        ],
      },
      routes: {
        addSyntaxLines: [
          `  ${renderCliCommand("routes add --channel zalo-bot dm:<user-id> [--bot <id>] [--policy <...>] [--require-mention <true|false>] [--allow-bots <true|false>]")}`,
        ],
        exampleLines: [
          `  ${renderCliCommand("routes add --channel zalo-bot dm:user-123 --bot default --policy open")}`,
          `  ${renderCliCommand("routes set-timezone --channel zalo-bot dm:user-123 --bot default Asia/Ho_Chi_Minh")}`,
        ],
      },
    };
  },
  describeStartupFailure: describeZaloBotStartupFailure,
  isEnabled: (loadedConfig) => loadedConfig.raw.bots.zaloBot.defaults.enabled,
  listBots: (loadedConfig) =>
    listZaloBotBots(loadedConfig.raw.bots.zaloBot).map(({ botId, config }) => ({
      botId,
      config,
    })),
  createRuntimeService: (context, bot) =>
    new ZaloBotPollingService(
      context.loadedConfig,
      context.agentService,
      context.processedEventsStore,
      context.activityStore,
      bot.botId,
      bot.config as ZaloBotCredentialConfig,
      context.reportLifecycle,
    ),
  renderHealthSummary: (state) => {
    switch (state) {
      case "starting":
        return "Zalo Bot channel is starting.";
      case "disabled":
        return "Zalo Bot channel is disabled in config.";
      case "stopped":
        return "Zalo Bot channel is stopped.";
    }
  },
  renderActiveHealthSummary: (serviceCount) =>
    `Zalo Bot polling connected for ${serviceCount} bot(s).`,
  buildPromptSurface: buildZaloBotPromptSurface,
  runMessageCommand: async (loadedConfig, command, surface) => {
    const bot = resolveZaloBotCredentials(
      loadedConfig.raw.bots.zaloBot,
      command.account,
    );
    const resolvedSurface = resolveZaloBotSurface({
      rawTarget: command.target,
      childSurface: command.childSurface,
      surface: surface?.channel === "zalo-bot" ? surface : null,
    });
    switch (command.action) {
      case "send":
        return {
          botId: bot.botId,
          result: await sendZaloBotMessageAction({
            botToken: bot.config.botToken,
            target: resolvedSurface?.provider.chatId ?? command.target!,
            message: command.message,
            media: command.media,
            inputFormat: command.inputFormat,
            renderMode: command.renderMode,
          }),
        };
      default:
        return {
          botId: bot.botId,
          result: await unsupportedZaloBotHistoryAction(command.action),
        };
    }
  },
  resolveMessageSurface: (command) =>
    resolveZaloBotSurface({
      rawTarget: command.target,
      childSurface: command.childSurface,
    }),
  resolveMessageReplyTarget: resolveZaloBotReplyTarget,
  resolveControlSurfaceContext: (params) => resolveZaloBotControlSurfaceContext(params),
  resolveBoundSurfaceRuntimeContext: (params) => resolveZaloBotBoundSurfaceRuntimeContext(params),
  renderControlTargetingHelpLines: () => [
    "  - Zalo Bot `--target` accepts `dm:<user-id>` for DM surfaces",
    "  - Zalo Bot does not support `--thread-id` or `--topic-id`",
    "  - `--sender <principal>` should use `zalo-bot:<user-id>`",
  ],
  renderLoopExampleLines: ({ command }) =>
    command === "create"
      ? [
          `  ${renderCliCommand("loops create --channel zalo-bot --target dm:user-123 --sender zalo-bot:user-123 5m check inbox")}`,
        ]
      : [
          `  ${renderCliCommand("loops list --channel zalo-bot --target dm:user-123")}`,
          `  ${renderCliCommand("loops status --channel zalo-bot --target dm:user-123")}`,
          `  ${renderCliCommand("loops --channel zalo-bot --target dm:user-123 --sender zalo-bot:user-123 5m")}`,
          `  ${renderCliCommand("loops cancel --channel zalo-bot --target dm:user-123 --all")}`,
        ],
  renderQueueExampleLines: () => [
    `  ${renderCliCommand("queues create --channel zalo-bot --target dm:user-123 --sender zalo-bot:user-123 review inbox")}`,
  ],
};

export default zaloBotChannelPlugin;
