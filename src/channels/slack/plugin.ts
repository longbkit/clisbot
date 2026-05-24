import type { AgentSessionTarget } from "../../agents/runtime/agent-service.ts";
import type { ChannelLoopCliAddressingState, ChannelPlugin } from "../integration/channel-plugin.ts";
import type {
  ParsedMessageCommand,
  ResolvedMessageSurface,
} from "../message/message-command.ts";
import { getCommandThreadId } from "../message/message-surface-helpers.ts";
import { listSlackBots } from "./config.ts";
import { resolveSlackBotCredentials, type SlackBotCredentialConfig } from "./config.ts";
import { SlackSocketService } from "./service.ts";
import { deleteSlackMessageAction, editSlackMessage, getSlackReactions, listSlackPins, pinSlackMessage, reactSlackMessage, readSlackMessages, searchSlackMessages, sendSlackMessage, sendSlackPoll, unpinSlackMessage } from "./message-actions.ts";
import { resolveSlackConversationRoute } from "./route-config.ts";
import { resolveSlackConversationTarget } from "./session-routing.ts";
import {
  resolveSlackBoundSurfaceRuntimeContext,
  resolveSlackControlSurfaceContext,
  provisionSlackLoopChildSurface,
} from "./control-surface.ts";
import { buildSlackPromptSurface, resolveSlackSurface } from "./surface.ts";
import { renderCliCommand } from "../../control/commands/cli-name.ts";
import { normalizeChannelUserId } from "../integration/channel-surface-contract-registry.ts";
import { describeSlackStartupFailure } from "./startup-failure.ts";
import { renderMarkdownReplyStyleHint } from "../message/agent-reply.ts";
import { slackChannelOperatorInventory } from "./operator-inventory.ts";
import { renderSlackTargetSyntax } from "./target-normalization.ts";

function resolveSlackReplyTarget(params: {
  loadedConfig: Parameters<ChannelPlugin["resolveMessageReplyTarget"]>[0]["loadedConfig"];
  command: ParsedMessageCommand;
  surface: ResolvedMessageSurface | null;
  botId: string;
}): AgentSessionTarget | null {
  const surface = resolveSlackSurface({
    rawTarget: params.command.target,
    childSurface: params.command.childSurface,
    surface: params.surface?.channel === "slack" ? params.surface : null,
  });
  if (!surface) {
    return null;
  }

  const resolved = resolveSlackConversationRoute(
    params.loadedConfig,
    {
      channel_type: surface.provider.channelType,
      channel: surface.provider.channelId,
    },
    {
      botId: params.botId,
    },
  );
  if (!resolved.route) {
    return null;
  }

  return resolveSlackConversationTarget({
    loadedConfig: params.loadedConfig,
    agentId: resolved.route.agentId,
    botId: params.botId,
    channelId: surface.provider.channelId,
    conversationKind: surface.provider.conversationKind,
    threadTs: getCommandThreadId(params.command) ?? params.command.replyTo,
    messageTs: params.command.replyTo ?? getCommandThreadId(params.command),
    replyToMode: resolved.route.replyToMode,
  });
}

function renderSlackLoopHelpLines(command: "overview" | "create") {
  const examples =
    command === "create"
      ? [
          `  ${renderCliCommand("loops create --channel slack --target group:C1234567890 --new-thread --sender slack:U1234567890 every day at 07:00 check CI")}`,
          `  ${renderCliCommand("loops create --channel slack --target dm:U1234567890 --new-thread --sender slack:U1234567890 every day at 09:00 check inbox")}`,
        ]
      : [
          `  ${renderCliCommand("loops --help --channel slack")}`,
          `  ${renderCliCommand("loops create --channel slack --target group:C1234567890 --new-thread --sender slack:U1234567890 every day at 07:00 check CI")}`,
          `  ${renderCliCommand("loops create --channel slack --target dm:U1234567890 --new-thread --sender slack:U1234567890 every day at 09:00 check inbox")}`,
        ];

  return [
    "",
    "Slack-specific extension:",
    "  - `--new-thread` asks Slack to provision a fresh managed child thread before the loop is persisted",
    "  - valid for parent `group:<channel-id>` targets and `dm:<user-id>` targets",
    ...examples,
  ];
}

function renderSlackControlTargetingHelpLines() {
  return [
    `  - Slack \`--target\` accepts ${renderSlackTargetSyntax()}`,
    "  - use `--thread-id` for an existing Slack thread ts",
    "  - omitting `--thread-id` targets the parent Slack channel/group/DM",
    "  - `--sender <principal>` should use `slack:<user-id>`",
  ];
}

function renderSlackLoopExampleLines(command: "overview" | "create") {
  if (command === "create") {
    return [
      `  ${renderCliCommand("loops create --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --sender slack:U1234567890 every day at 07:00 check CI")}`,
      `  ${renderCliCommand("loops create --channel slack --target group:C1234567890 --new-thread --sender slack:U1234567890 every day at 07:00 check CI")}`,
      `  ${renderCliCommand("loops create --channel slack --target dm:U1234567890 --new-thread --sender slack:U1234567890 every day at 09:00 check inbox")}`,
    ];
  }

  return [
    `  ${renderCliCommand("loops list --channel slack --target group:C1234567890 --thread-id 1712345678.123456")}`,
    `  ${renderCliCommand("loops status --channel slack --target group:C1234567890 --thread-id 1712345678.123456")}`,
    `  ${renderCliCommand("loops --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --sender slack:U1234567890 3 review backlog")}`,
    `  ${renderCliCommand("loops cancel --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --all")}`,
  ];
}

function hasSlackNewThreadFlag(args: string[]) {
  return args.includes("--new-thread");
}

function stripSlackLoopExpressionArgs(args: string[]) {
  return args.filter((arg) => arg !== "--new-thread");
}

function resolveSlackLoopCliAddressing(params: {
  intent: "help" | "create" | "list" | "status" | "cancel";
  args: string[];
  addressing: ChannelLoopCliAddressingState;
}) {
  if (!hasSlackNewThreadFlag(params.args)) {
    return params.addressing;
  }
  if (params.intent !== "create") {
    throw new Error("`--new-thread` only applies when creating a new child surface.");
  }
  if (params.addressing.channel && params.addressing.channel !== "slack") {
    throw new Error("`--new-thread` is a Slack loop extension; use `--channel slack`.");
  }
  if (!params.addressing.channel || !params.addressing.target) {
    throw new Error("`--new-thread` requires `--channel slack` and a parent `--target`.");
  }
  if (params.addressing.childSurface) {
    throw new Error("Use either `--new-thread` or an explicit thread/topic id, not both.");
  }
  return {
    ...params.addressing,
    provisionChildSurface: true,
  };
}

export const slackChannelPlugin: ChannelPlugin = {
  id: "slack",
  displayName: "Slack",
  operatorInventory: slackChannelOperatorInventory,
  interactionRenderer: "markdown",
  senderPrincipalExample: "slack:U1234567890",
  buildDefaultDirectMessageTarget: (providerUserId) => {
    const normalized = normalizeChannelUserId("slack", providerUserId);
    return normalized ? `user:${normalized}` : "";
  },
  childSurfaceCli: {
    kind: "thread",
    primaryFlag: "--thread-id",
  },
  agentReply: {
    inputFormat: "md",
    renderMode: "blocks",
    styleHint: renderMarkdownReplyStyleHint(
      "Keep each paragraph, list, or code block under 2500 chars.",
    ),
    resolveTarget: (identity) =>
      identity.channelId ? `channel:${identity.channelId}` : null,
    resolveChildSurface: (identity) =>
      identity.threadTs
        ? {
            flag: "--thread-id",
            value: identity.threadTs,
          }
        : null,
  },
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
  },
  bootstrapCli: {
    accountFlag: "--slack-account",
    tokenFlags: [
      { flag: "--slack-app-token", field: "appToken" },
      { flag: "--slack-bot-token", field: "botToken" },
    ],
    usageLine:
      "[--slack-account <id> --slack-app-token <ENV_NAME|${ENV_NAME}|literal> --slack-bot-token <ENV_NAME|${ENV_NAME}|literal>]...",
    renderExampleCommands: (commandName) => [
      renderCliCommand(
        `${commandName} --cli codex --bot-type team --slack-app-token SLACK_APP_TOKEN --slack-bot-token SLACK_BOT_TOKEN`,
      ),
    ],
  },
  loopCli: {
    stripExpressionArgs: stripSlackLoopExpressionArgs,
    resolveAddressing: resolveSlackLoopCliAddressing,
    renderScopedCommandArgs: ({ addressing }) =>
      addressing.provisionChildSurface ? ["--new-thread"] : [],
  },
  get operatorGuidance() {
    return {
      dmFirstLine: "DM the Slack bot first to confirm it responds normally",
      pairingCodeLine: "Send a direct message (DM) to the Slack bot. Say `hi` to receive a pairing code.",
      onboardingLine: "Slack: mention `@<botname> \\start` in the target channel to verify mention flow",
      setupMissingLine: "slack: no explicit channel or group routes are configured yet",
      addRouteLines: [
        `add group: ${renderCliCommand("routes add --channel slack group:<channelId> --bot default", { inline: true })}`,
      ],
      overrideLine:
        `optional agent override if that route should use a different agent than the one currently assigned to that bot by default: ${renderCliCommand("routes set-agent --channel slack group:<channelId> --bot default --agent <id>", { inline: true })}`,
    };
  },
  get controlHelp() {
    return {
      message: {
        targetLines: [
          `Slack accepts ${renderSlackTargetSyntax()}`,
          "  `--thread-id <id>` is a Slack thread ts",
        ],
        renderLines: [
          "  - Slack native: Markdown/plain -> mrkdwn",
          "  - Slack none: use with --input mrkdwn or blocks",
          "  - blocks: Slack only. Render Markdown into Block Kit",
          "  - mrkdwn: Slack only",
        ],
        lengthGuidanceLines: [
          "  Slack text/mrkdwn            Prefer text under 4000 chars; Slack truncates very long text after 40000",
          "  Slack blocks                 Max 50 blocks; keep header text under 150 and section text under 3000",
        ],
        exampleLines: [
          `  ${renderCliCommand("message send --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --message \"## Status\"")}`,
          `  ${renderCliCommand("message send --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --input mrkdwn --render none --message \"*Status*\"")}`,
          `  ${renderCliCommand("message send --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --input blocks --render none --body-file ./reply-blocks.json")}`,
        ],
      },
      routes: {
        addSyntaxLines: [
          `  ${renderCliCommand("routes add --channel slack group:<id> [--bot <id>] [--policy <...>] [--require-mention <true|false>] [--allow-bots <true|false>]")}`,
        ],
        exampleLines: [
          `  ${renderCliCommand("routes add-allow-user --channel slack group:* --bot default --user U_OWNER")}`,
          `  ${renderCliCommand("routes add-allow-user --channel slack dm:* --bot support --user U123ABC456")}`,
          `  ${renderCliCommand("routes add-allow-user --channel slack group:C1234567890 --bot default --user U_OWNER")}`,
        ],
      },
    };
  },
  describeStartupFailure: describeSlackStartupFailure,
  isEnabled: (loadedConfig) => loadedConfig.raw.bots.slack.defaults.enabled,
  listBots: (loadedConfig) =>
    listSlackBots(loadedConfig.raw.bots.slack).map(({ botId, config }) => ({
      botId,
      config,
    })),
  createRuntimeService: (context, bot) =>
    new SlackSocketService(
      context.loadedConfig,
      context.agentService,
      context.processedEventsStore,
      context.activityStore,
      bot.botId,
      bot.config as SlackBotCredentialConfig,
    ),
  renderHealthSummary: (state) => {
    switch (state) {
      case "starting":
        return "Slack channel is starting.";
      case "disabled":
        return "Slack channel is disabled in config.";
      case "stopped":
        return "Slack channel is stopped.";
    }
  },
  renderActiveHealthSummary: (serviceCount) =>
    `Slack Socket Mode connected for ${serviceCount} bot(s).`,
  buildPromptSurface: buildSlackPromptSurface,
  runMessageCommand: async (loadedConfig, command, surface) => {
    const bot = resolveSlackBotCredentials(
      loadedConfig.raw.bots.slack,
      command.account,
    );
    const resolvedSurface = resolveSlackSurface({
      rawTarget: command.target,
      childSurface: command.childSurface,
      surface: surface?.channel === "slack" ? surface : null,
    });
    const shared = {
      botToken: bot.config.botToken,
      target: resolvedSurface?.rawTarget ?? command.target!,
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
    };

    switch (command.action) {
      case "send":
        return { botId: bot.botId, result: await sendSlackMessage(shared) };
      case "poll":
        return { botId: bot.botId, result: await sendSlackPoll(shared) };
      case "react":
        return { botId: bot.botId, result: await reactSlackMessage(shared) };
      case "reactions":
        return { botId: bot.botId, result: await getSlackReactions(shared) };
      case "read":
        return { botId: bot.botId, result: await readSlackMessages(shared) };
      case "edit":
        return { botId: bot.botId, result: await editSlackMessage(shared) };
      case "delete":
        return { botId: bot.botId, result: await deleteSlackMessageAction(shared) };
      case "pin":
        return { botId: bot.botId, result: await pinSlackMessage(shared) };
      case "unpin":
        return { botId: bot.botId, result: await unpinSlackMessage(shared) };
      case "pins":
        return { botId: bot.botId, result: await listSlackPins(shared) };
      case "search":
        return { botId: bot.botId, result: await searchSlackMessages(shared) };
    }
  },
  resolveMessageSurface: (command) =>
    resolveSlackSurface({
      rawTarget: command.target,
      childSurface: command.childSurface,
    }),
  resolveMessageReplyTarget: resolveSlackReplyTarget,
  resolveControlSurfaceContext: (params) => resolveSlackControlSurfaceContext(params),
  resolveBoundSurfaceRuntimeContext: (params) => resolveSlackBoundSurfaceRuntimeContext(params),
  renderLoopHelpLines: ({ command }) => renderSlackLoopHelpLines(command),
  renderControlTargetingHelpLines: () => renderSlackControlTargetingHelpLines(),
  renderLoopExampleLines: ({ command }) => renderSlackLoopExampleLines(command),
  renderQueueExampleLines: () => [
    `  ${renderCliCommand("queues create --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --sender slack:U1234567890 review backlog")}`,
  ],
  provisionLoopChildSurface: (params) => provisionSlackLoopChildSurface(params),
};

export default slackChannelPlugin;
