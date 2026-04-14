import { AgentService, type AgentSessionTarget } from "../agents/agent-service.ts";
import { loadConfig, type LoadedConfig } from "../config/load-config.ts";
import { listChannelPlugins } from "../channels/registry.ts";
import { type ChannelPlugin } from "../channels/channel-plugin.ts";
import type { ParsedMessageCommand, MessageAction } from "../channels/message-command.ts";

function getConfigPath() {
  return process.env.CLISBOT_CONFIG_PATH;
}

type MessageCliDependencies = {
  loadConfig: (configPath?: string) => Promise<LoadedConfig>;
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
    media: parseOptionValue(rest, "--media"),
    messageId: parseOptionValue(rest, "--message-id"),
    emoji: parseOptionValue(rest, "--emoji"),
    remove: hasFlag(rest, "--remove"),
    threadId: parseOptionValue(rest, "--thread-id"),
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
  };
}

export function renderMessageHelp() {
  return [
    "clisbot message",
    "",
    "Usage:",
    "  clisbot message send --channel <slack|telegram> --target <dest> --message <text> [--account <id>] [--media <path-or-url>] [--reply-to <id>] [--thread-id <id>] [--force-document] [--silent] [--progress|--final]",
    "  clisbot message poll --channel <slack|telegram> --target <dest> --poll-question <text> --poll-option <value> [--poll-option <value>] [--account <id>] [--thread-id <id>] [--silent]",
    "  clisbot message react --channel <slack|telegram> --target <dest> --message-id <id> --emoji <emoji> [--account <id>] [--remove]",
    "  clisbot message reactions --channel <slack|telegram> --target <dest> --message-id <id> [--account <id>]",
    "  clisbot message read --channel <slack|telegram> --target <dest> [--account <id>] [--limit <n>]",
    "  clisbot message edit --channel <slack|telegram> --target <dest> --message-id <id> --message <text> [--account <id>]",
    "  clisbot message delete --channel <slack|telegram> --target <dest> --message-id <id> [--account <id>]",
    "  clisbot message pin --channel <slack|telegram> --target <dest> --message-id <id> [--account <id>]",
    "  clisbot message unpin --channel <slack|telegram> --target <dest> [--message-id <id>] [--account <id>]",
    "  clisbot message pins --channel <slack|telegram> --target <dest> [--account <id>]",
    "  clisbot message search --channel <slack|telegram> --target <dest> --query <text> [--account <id>] [--limit <n>]",
  ].join("\n");
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
  if (command.progress && command.final) {
    throw new Error("--progress and --final cannot be used together");
  }
  assertTarget(command);

  const loadedConfig = await dependencies.loadConfig(getConfigPath());
  const plugin = dependencies.plugins.find((entry) => entry.id === command.channel);
  if (!plugin) {
    throw new Error(`Unsupported message channel: ${command.channel}`);
  }

  const execution = await plugin.runMessageCommand(loadedConfig, command);
  const replyTarget =
    command.action === "send" || command.action === "poll"
      ? plugin.resolveMessageReplyTarget({
        loadedConfig,
        command,
        accountId: execution.accountId,
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
