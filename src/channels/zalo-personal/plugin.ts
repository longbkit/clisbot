import type { AgentSessionTarget } from "../../agents/runtime/agent-service.ts";
import type { ChannelPlugin } from "../integration/channel-plugin.ts";
import type {
  ParsedMessageCommand,
  ResolvedMessageSurface,
} from "../message/message-command.ts";
import {
  listZaloPersonalBots,
  resolveZaloPersonalCredentials,
  type ZaloPersonalCredentialConfig,
} from "./config.ts";
import { ZaloPersonalListenerService } from "./service.ts";
import {
  deleteZaloPersonalMessageAction,
  reactZaloPersonalMessageAction,
  readZaloPersonalMessageAction,
  sendZaloPersonalMessageAction,
} from "./message-actions.ts";
import { resolveZaloPersonalConversationRoute } from "./route-config.ts";
import { resolveZaloPersonalConversationTarget } from "./session-routing.ts";
import {
  resolveZaloPersonalBoundSurfaceRuntimeContext,
  resolveZaloPersonalControlSurfaceContext,
} from "./control-surface.ts";
import { renderCliCommand } from "../../control/commands/cli-name.ts";
import { normalizeChannelUserId } from "../integration/channel-surface-contract-registry.ts";
import { renderPlainTextReplyStyleHint } from "../message/agent-reply.ts";
import {
  buildZaloPersonalPromptSurface,
  resolveZaloPersonalSurface,
} from "./surface.ts";
import { zaloPersonalChannelOperatorInventory } from "./operator-inventory.ts";

function resolveZaloPersonalReplyTarget(params: {
  loadedConfig: Parameters<ChannelPlugin["resolveMessageReplyTarget"]>[0]["loadedConfig"];
  command: ParsedMessageCommand;
  surface: ResolvedMessageSurface | null;
  botId: string;
}): AgentSessionTarget | null {
  const surface = resolveZaloPersonalSurface({
    rawTarget: params.command.target,
    childSurface: params.command.childSurface,
    surface: params.surface?.channel === "zalo-personal" ? params.surface : null,
  });
  if (!surface) {
    return null;
  }
  const conversation = resolveZaloPersonalConversationRoute({
    loadedConfig: params.loadedConfig,
    conversationKind: surface.provider.conversationKind,
    chatId: surface.provider.chatId,
    senderId: surface.provider.userId,
    botId: params.botId,
  });
  if (!conversation.route) {
    return null;
  }
  return resolveZaloPersonalConversationTarget({
    loadedConfig: params.loadedConfig,
    agentId: conversation.route.agentId,
    botId: params.botId,
    chatId: surface.provider.chatId,
    userId: surface.provider.userId,
    conversationKind: conversation.conversationKind,
  });
}

export const zaloPersonalChannelPlugin: ChannelPlugin = {
  id: "zalo-personal",
  displayName: "Zalo Personal",
  operatorInventory: zaloPersonalChannelOperatorInventory,
  interactionRenderer: "plain",
  senderPrincipalExample: "zalo-personal:<user-id>",
  buildDefaultDirectMessageTarget: (providerUserId) =>
    normalizeChannelUserId("zalo-personal", providerUserId),
  agentReply: {
    inputFormat: "md",
    renderMode: "native",
    styleHint: [
      "Zalo Personal is append-only until edit/update support is proven.",
      renderPlainTextReplyStyleHint("Keep the message body under 3000 chars."),
    ].join(" "),
    resolveTarget: (identity) => identity.chatId ?? null,
  },
  capabilities: {
    surfaceKinds: ["dm", "group"],
    messageActions: ["send", "react", "read", "delete"],
    supportsMessageCustomSubtree: false,
  },
  bootstrapCli: {
    tokenFlags: [],
    usageLine: "[--channel zalo-personal [--bot <id>] [--qr-path <path>]]",
    renderExampleCommands: (commandName) => [
      renderCliCommand(
        `${commandName} --cli codex --bot-type personal --channel zalo-personal --qr-path ./zalo-personal-default-qr.png`,
      ),
    ],
  },
  get operatorGuidance() {
    return {
      dmFirstLine: "DM the Zalo Personal account first to confirm the listener receives messages",
      pairingCodeLine: "Send a direct message (DM) to the Zalo Personal account. Send `hi` to receive a pairing code.",
      onboardingLine: "Zalo Personal: use QR login, then DM the account for pairing flow and queue/loop validation",
      setupMissingLine: "zalo-personal: no explicit DM or group routes are configured yet",
      addRouteLines: [
        `add DM: ${renderCliCommand("routes add --channel zalo-personal dm:<user-id> --bot default", { inline: true })}`,
        `add group: ${renderCliCommand("routes add --channel zalo-personal group:<group-id> --bot default --require-mention true", { inline: true })}`,
      ],
      overrideLine:
        `optional agent override if that surface should use a different agent than the one currently assigned to that bot by default: ${renderCliCommand("routes set-agent --channel zalo-personal dm:<user-id> --bot default --agent <id>", { inline: true })}`,
    };
  },
  get controlHelp() {
    return {
      message: {
        targetLines: [
          "Zalo Personal `--target` accepts `dm:<user-id>` or `group:<group-id>`",
        ],
        renderLines: [
          "  - Zalo Personal native: Markdown -> visible text plus Zalo TextStyle ranges where supported",
        ],
        exampleLines: [
          `  ${renderCliCommand("message send --channel zalo-personal --bot work --target dm:user-123 --message \"Status\"")}`,
        ],
      },
      routes: {
        addSyntaxLines: [
          `  ${renderCliCommand("routes add --channel zalo-personal <dm:<id>|group:<id>> [--bot <id>] [--policy <...>] [--require-mention <true|false>] [--allow-bots <true|false>]")}`,
        ],
        exampleLines: [
          `  ${renderCliCommand("routes add --channel zalo-personal dm:user-123 --bot work --policy pairing")}`,
          `  ${renderCliCommand("routes add --channel zalo-personal group:group-123 --bot work --require-mention true --policy allowlist")}`,
        ],
      },
    };
  },
  describeStartupFailure: (error) => ({
    summary: "Zalo Personal listener failed to start.",
    detail: error instanceof Error ? error.message : String(error),
    actions: [
      `run ${renderCliCommand("bots status --channel zalo-personal --bot <id>", { inline: true })} to inspect session and connection state`,
      `run ${renderCliCommand("bots login --channel zalo-personal --bot <id> --qr-path ./zalo-qr.png", { inline: true })} if the session is missing or expired`,
      "confirm no other Zalo Web/browser/listener is connected to the same personal account",
    ],
  }),
  isEnabled: (loadedConfig) => loadedConfig.raw.bots.zaloPersonal.defaults.enabled,
  listBots: (loadedConfig) =>
    listZaloPersonalBots(loadedConfig.raw.bots.zaloPersonal).map(({ botId, config }) => ({
      botId,
      config,
    })),
  createRuntimeService: (context, bot) =>
    new ZaloPersonalListenerService(
      context.loadedConfig,
      context.agentService,
      context.processedEventsStore,
      context.activityStore,
      bot.botId,
      bot.config as ZaloPersonalCredentialConfig,
      context.reportLifecycle,
    ),
  renderHealthSummary: (state) => {
    switch (state) {
      case "starting":
        return "Zalo Personal listener is starting.";
      case "disabled":
        return "Zalo Personal channel is disabled in config.";
      case "stopped":
        return "Zalo Personal listener is stopped.";
    }
  },
  renderActiveHealthSummary: (serviceCount) =>
    `Zalo Personal listener connected for ${serviceCount} bot(s).`,
  buildPromptSurface: buildZaloPersonalPromptSurface,
  runMessageCommand: async (loadedConfig, command, surface) => {
    const bot = resolveZaloPersonalCredentials(
      loadedConfig.raw.bots.zaloPersonal,
      command.account,
    );
    const resolvedSurface = resolveZaloPersonalSurface({
      rawTarget: command.target,
      childSurface: command.childSurface,
      surface: surface?.channel === "zalo-personal" ? surface : null,
    });
    switch (command.action) {
      case "send":
        return {
          botId: bot.botId,
          result: await sendZaloPersonalMessageAction({
            tokenFile: bot.config.tokenFile,
            target: {
              conversationKind: resolvedSurface?.provider.conversationKind ?? "dm",
              chatId: resolvedSurface?.provider.chatId ?? command.target!,
            },
            message: command.message,
            media: command.media,
            fileType: command.fileType,
            inputFormat: command.inputFormat,
            renderMode: command.renderMode,
          }),
        };
      case "react":
        return {
          botId: bot.botId,
          result: await reactZaloPersonalMessageAction({
            tokenFile: bot.config.tokenFile,
            target: {
              conversationKind: resolvedSurface?.provider.conversationKind ?? "dm",
              chatId: resolvedSurface?.provider.chatId ?? command.target!,
            },
            messageId: command.messageId ?? "",
            emoji: command.emoji ?? "",
            remove: command.remove,
          }),
        };
      case "read":
        return {
          botId: bot.botId,
          result: await readZaloPersonalMessageAction({
            tokenFile: bot.config.tokenFile,
            target: {
              conversationKind: resolvedSurface?.provider.conversationKind ?? "dm",
              chatId: resolvedSurface?.provider.chatId ?? command.target!,
            },
            limit: command.limit,
          }),
        };
      case "delete":
        return {
          botId: bot.botId,
          result: await deleteZaloPersonalMessageAction({
            tokenFile: bot.config.tokenFile,
            target: {
              conversationKind: resolvedSurface?.provider.conversationKind ?? "dm",
              chatId: resolvedSurface?.provider.chatId ?? command.target!,
            },
            messageId: command.messageId ?? "",
            confirm: command.confirm,
          }),
        };
      default:
        throw new Error(`Zalo Personal does not support message ${command.action} in clisbot yet.`);
    }
  },
  resolveMessageSurface: (command) =>
    resolveZaloPersonalSurface({
      rawTarget: command.target,
      childSurface: command.childSurface,
    }),
  resolveMessageReplyTarget: resolveZaloPersonalReplyTarget,
  resolveControlSurfaceContext: (params) => resolveZaloPersonalControlSurfaceContext(params),
  resolveBoundSurfaceRuntimeContext: (params) => resolveZaloPersonalBoundSurfaceRuntimeContext(params),
  renderControlTargetingHelpLines: () => [
    "  - Zalo Personal `--target` accepts `dm:<user-id>` or `group:<group-id>`",
    "  - Zalo Personal does not support `--thread-id` or `--topic-id`",
    "  - `--sender <principal>` should use `zalo-personal:<user-id>`",
  ],
  renderLoopExampleLines: ({ command }) =>
    command === "create"
      ? [
          `  ${renderCliCommand("loops create --channel zalo-personal --bot work --target dm:user-123 --sender zalo-personal:user-123 5m check inbox")}`,
        ]
      : [
          `  ${renderCliCommand("loops list --channel zalo-personal --bot work --target dm:user-123")}`,
          `  ${renderCliCommand("loops status --channel zalo-personal --bot work --target dm:user-123")}`,
          `  ${renderCliCommand("loops cancel --channel zalo-personal --bot work --target dm:user-123 --all")}`,
        ],
  renderQueueExampleLines: () => [
    `  ${renderCliCommand("queues create --channel zalo-personal --bot work --target dm:user-123 --sender zalo-personal:user-123 review inbox")}`,
  ],
};

export default zaloPersonalChannelPlugin;
