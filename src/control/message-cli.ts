import { AgentService, type AgentSessionTarget } from "../agents/agent-service.ts";
import { readFile } from "node:fs/promises";
import {
  loadConfig,
  type LoadConfigOptions,
  type LoadedConfig,
} from "../config/load-config.ts";
import { listChannelPlugins } from "../channels/registry.ts";
import { type ChannelPlugin } from "../channels/channel-plugin.ts";
import type { ParsedMessageCommand, MessageAction } from "../channels/message-command.ts";
import {
  parseMessageInputFormat,
  parseMessageRenderMode,
} from "../channels/message-format.ts";
import { renderSlackTargetSyntax } from "../config/route-contract.ts";
import { renderCliCommand } from "../shared/cli-name.ts";

function getConfigPath() {
  return process.env.CLISBOT_CONFIG_PATH;
}

type MessageCliDependencies = {
  loadConfig: (configPath?: string, options?: LoadConfigOptions) => Promise<LoadedConfig>;
  plugins: ChannelPlugin[];
  print: (text: string) => void;
    recordConversationReply: (params: {
      loadedConfig: LoadedConfig;
      target: AgentSessionTarget;
      kind?: "reply" | "progress" | "final";
      source?: "channel" | "message-tool";
    }) => Promise<void>;
};

const defaultMessageCliDependencies: MessageCliDependencies = {
  loadConfig,
  plugins: listChannelPlugins(),
  print: (text) => console.log(text),
  recordConversationReply: async ({ loadedConfig, target, kind, source }) => {
    const agentService = new AgentService(loadedConfig);
    await agentService.recordConversationReply(target, kind, source);
  },
};

function parseRepeatedOption(args: string[], name: string) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) {
      continue;
    }
    const value = args[index + 1]?.trim();
    if (!value) {
      throw new Error(`Missing value for ${name}`);
    }
    values.push(value);
  }
  return values;
}

function parseOptionValue(args: string[], name: string) {
  const values = parseRepeatedOption(args, name);
  return values.length > 0 ? values.at(-1) : undefined;
}

function parseAliasedOptionValue(args: string[], preferredName: string, aliasName: string) {
  const preferredValues = parseRepeatedOption(args, preferredName);
  const aliasValues = parseRepeatedOption(args, aliasName);
  if (preferredValues.length > 0 && aliasValues.length > 0) {
    throw new Error(`${preferredName} and ${aliasName} are aliases; use only one`);
  }
  return preferredValues.at(-1) ?? aliasValues.at(-1);
}

function parseThreadingOptions(args: string[], channel: "slack" | "telegram") {
  const threadId = parseOptionValue(args, "--thread-id");
  const topicId = parseOptionValue(args, "--topic-id");
  if (threadId && topicId) {
    throw new Error("Use only one of `--thread-id` or `--topic-id`.");
  }
  if (channel === "slack" && topicId) {
    throw new Error("Slack message commands use `--thread-id`, not `--topic-id`.");
  }
  if (channel === "telegram" && threadId) {
    throw new Error("Telegram message commands use `--topic-id`, not `--thread-id`.");
  }
  return channel === "telegram" ? topicId : threadId;
}

function parseMessageBodyFileOption(args: string[]) {
  const bodyFileValues = parseRepeatedOption(args, "--body-file");
  const messageFileValues = parseRepeatedOption(args, "--message-file");
  if (bodyFileValues.length > 0 && messageFileValues.length > 0) {
    throw new Error("--body-file and --message-file are aliases; use only one");
  }
  return bodyFileValues.at(-1) ?? messageFileValues.at(-1);
}

function parseMessageAttachmentOption(args: string[]) {
  return parseAliasedOptionValue(args, "--file", "--media");
}

function parseIntegerOption(args: string[], name: string) {
  const raw = parseOptionValue(args, name);
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} requires a number`);
  }
  return parsed;
}

function hasFlag(args: string[], name: string) {
  return args.includes(name);
}

function resolveReplyKind(command: ParsedMessageCommand) {
  if (command.final) {
    return "final" as const;
  }
  if (command.progress) {
    return "progress" as const;
  }
  return "reply" as const;
}

function parseMessageCommand(args: string[]): ParsedMessageCommand | null {
  const rawAction = args[0];
  if (!rawAction || rawAction === "--help" || rawAction === "-h" || rawAction === "help") {
    return null;
  }
  const action = rawAction as MessageAction;
  const rest = args.slice(1);
  const channel = parseOptionValue(rest, "--channel");
  if (channel !== "slack" && channel !== "telegram") {
    throw new Error("--channel <slack|telegram> is required");
  }

  return {
    action,
    channel,
    account: parseOptionValue(rest, "--account"),
    target: parseOptionValue(rest, "--target"),
    message: parseOptionValue(rest, "--message") ?? parseOptionValue(rest, "-m"),
    messageFile: parseMessageBodyFileOption(rest),
    media: parseMessageAttachmentOption(rest),
    messageId: parseOptionValue(rest, "--message-id"),
    emoji: parseOptionValue(rest, "--emoji"),
    remove: hasFlag(rest, "--remove"),
    threadId: parseThreadingOptions(rest, channel),
    replyTo: parseOptionValue(rest, "--reply-to"),
    limit: parseIntegerOption(rest, "--limit"),
    query: parseOptionValue(rest, "--query"),
    pollQuestion: parseOptionValue(rest, "--poll-question"),
    pollOptions: parseRepeatedOption(rest, "--poll-option"),
    forceDocument: hasFlag(rest, "--force-document"),
    silent: hasFlag(rest, "--silent"),
    progress: hasFlag(rest, "--progress"),
    final: hasFlag(rest, "--final"),
    json: hasFlag(rest, "--json"),
    inputFormat: parseMessageInputFormat(parseOptionValue(rest, "--input")),
    renderMode: parseMessageRenderMode(parseOptionValue(rest, "--render")),
  };
}

export function renderMessageHelp() {
  return [
    renderCliCommand("message"),
    "",
    "Usage:",
    `  ${renderCliCommand("message send --channel <slack|telegram> --target <dest> [--message <text> | --body-file <path>] [--input <plain|md|html|mrkdwn|blocks>] [--render <native|none|html|mrkdwn|blocks>] [--account <id>] [--file <path-or-url>] [--reply-to <id>] [--thread-id <slack-thread-ts>] [--topic-id <telegram-topic-id>] [--force-document] [--silent] [--progress|--final]")}`,
    `  ${renderCliCommand("message poll --channel <slack|telegram> --target <dest> --poll-question <text> --poll-option <value> [--poll-option <value>] [--account <id>] [--thread-id <slack-thread-ts>] [--topic-id <telegram-topic-id>] [--silent]")}`,
    `  ${renderCliCommand("message react --channel <slack|telegram> --target <dest> --message-id <id> --emoji <emoji> [--account <id>] [--remove]")}`,
    `  ${renderCliCommand("message reactions --channel <slack|telegram> --target <dest> --message-id <id> [--account <id>]")}`,
    `  ${renderCliCommand("message read --channel <slack|telegram> --target <dest> [--account <id>] [--limit <n>]")}`,
    `  ${renderCliCommand("message edit --channel <slack|telegram> --target <dest> --message-id <id> [--message <text> | --body-file <path>] [--input <plain|md|html|mrkdwn|blocks>] [--render <native|none|html|mrkdwn|blocks>] [--account <id>]")}`,
    `  ${renderCliCommand("message delete --channel <slack|telegram> --target <dest> --message-id <id> [--account <id>]")}`,
    `  ${renderCliCommand("message pin --channel <slack|telegram> --target <dest> --message-id <id> [--account <id>]")}`,
    `  ${renderCliCommand("message unpin --channel <slack|telegram> --target <dest> [--message-id <id>] [--account <id>]")}`,
    `  ${renderCliCommand("message pins --channel <slack|telegram> --target <dest> [--account <id>]")}`,
    `  ${renderCliCommand("message search --channel <slack|telegram> --target <dest> --query <text> [--account <id>] [--limit <n>]")}`,
    "",
    "Send/Edit Content Options:",
    "  --message <text>              Inline message body",
    "  --body-file <path>            Read the message body from a file",
    "                                Alias: --message-file (compat only)",
    "  --file <path-or-url>          Attach a file or remote URL",
    "                                Alias: --media (compat only)",
    "  --input <plain|md|html|mrkdwn|blocks>",
    "                               Input content format. Default: md",
    "  --render <native|none|html|mrkdwn|blocks>",
    "                               Output rendering mode. Default: native",
    "",
    "Render Rules:",
    "  native                        Channel-owned default rendering",
    "                                - Telegram: Markdown/plain -> safe HTML",
    "                                - Slack: Markdown/plain -> mrkdwn",
    "  none                          Content is already destination-native",
    "                                - Telegram: use with --input html",
    "                                - Slack: use with --input mrkdwn or blocks",
    "  blocks                        Slack only. Render Markdown into Block Kit",
    "  html                          Telegram only",
    "  mrkdwn                        Slack only",
    "",
    "Length Guidance:",
    "  Telegram native/html         Final payload must stay under 4096 chars; leave headroom after HTML-safe rendering",
    "  Slack text/mrkdwn            Prefer text under 4000 chars; Slack truncates very long text after 40000",
    "  Slack blocks                 Max 50 blocks; keep header text under 150 and section text under 3000",
    "",
    "Threading:",
    "  --thread-id <id>              Slack thread ts",
    "  --topic-id <id>               Telegram topic id",
    "",
    "Targets:",
    `  Slack accepts ${renderSlackTargetSyntax()}`,
    "  Telegram `--target` is the numeric chat id",
    "",
    "Examples:",
    `  ${renderCliCommand("message send --channel telegram --target -1001234567890 --topic-id 42 --message \"## Status\"")}`,
    `  ${renderCliCommand("message send --channel telegram --target -1001234567890 --topic-id 42 --input html --render none --message \"<b>Status</b>\"")}`,
    `  ${renderCliCommand("message send --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --message \"## Status\"")}`,
    `  ${renderCliCommand("message send --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --input mrkdwn --render none --message \"*Status*\"")}`,
    `  ${renderCliCommand("message send --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --input blocks --render none --body-file ./reply-blocks.json")}`,
  ].join("\n");
}

async function resolveCommandMessage(command: ParsedMessageCommand) {
  if (!command.messageFile) {
    return command;
  }
  if (command.message) {
    throw new Error("--message cannot be used together with --body-file or --message-file");
  }
  return {
    ...command,
    message: await readFile(command.messageFile, "utf8"),
  };
}

function assertTarget(command: ParsedMessageCommand) {
  if (!command.target) {
    throw new Error("--target is required");
  }
}

export async function runMessageCli(
  args: string[],
  dependencies: MessageCliDependencies = defaultMessageCliDependencies,
) {
  const command = parseMessageCommand(args);
  if (!command) {
    dependencies.print(renderMessageHelp());
    return;
  }
  const resolvedCommand = await resolveCommandMessage(command);
  if (resolvedCommand.progress && resolvedCommand.final) {
    throw new Error("--progress and --final cannot be used together");
  }
  assertTarget(resolvedCommand);

  const loadedConfig = await dependencies.loadConfig(getConfigPath(), {
    materializeChannels: [resolvedCommand.channel],
  });
  const plugin = dependencies.plugins.find((entry) => entry.id === resolvedCommand.channel);
  if (!plugin) {
    throw new Error(`Unsupported message channel: ${resolvedCommand.channel}`);
  }

  const execution = await plugin.runMessageCommand(loadedConfig, resolvedCommand);
  const replyTarget =
    resolvedCommand.action === "send" || resolvedCommand.action === "poll"
      ? plugin.resolveMessageReplyTarget({
        loadedConfig,
        command: resolvedCommand,
        botId: execution.botId,
      })
      : null;
  if (replyTarget) {
    await dependencies.recordConversationReply({
      loadedConfig,
      target: replyTarget,
      kind: resolveReplyKind(command),
      source: "message-tool",
    });
  }

  if (command.json) {
    dependencies.print(JSON.stringify(execution.result, null, 2));
    return;
  }

  dependencies.print(JSON.stringify(execution.result, null, 2));
}
