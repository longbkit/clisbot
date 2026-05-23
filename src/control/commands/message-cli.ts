import { AgentService, type AgentSessionTarget } from "../../agents/runtime/agent-service.ts";
import { readFile } from "node:fs/promises";
import {
  loadConfig,
  type LoadConfigOptions,
  type LoadedConfig,
} from "../../config/core/load-config.ts";
import {
  getChannelPlugin,
  listChannelPlugins,
  parseRegisteredChannelOrThrow,
  renderChannelNamePlaceholder,
  renderSupportedChannelsNote,
} from "../../channels/catalog/registry.ts";
import { type ChannelPlugin } from "../../channels/integration/channel-plugin.ts";
import type {
  MessageAction,
  MessageChannel,
  ParsedCustomMessageCommand,
  ParsedMessageCliCommand,
  ParsedMessageCommand,
} from "../../channels/message/message-command.ts";
import {
  parseMessageInputFormat,
  parseMessageRenderMode,
} from "../../channels/message/message-format.ts";
import {
  parseChildSurfaceSelector,
  parseOptionValue,
} from "../../channels/message/message-surface-helpers.ts";
import { renderCliCommand } from "./cli-name.ts";

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

function parseAliasedOptionValue(args: string[], preferredName: string, aliasName: string) {
  const preferredValues = parseRepeatedOption(args, preferredName);
  const aliasValues = parseRepeatedOption(args, aliasName);
  if (preferredValues.length > 0 && aliasValues.length > 0) {
    throw new Error(`${preferredName} and ${aliasName} are aliases; use only one`);
  }
  if (preferredValues.length > 1) {
    throw new Error(`${preferredName} accepts one value; multiple attachments are not supported yet`);
  }
  if (aliasValues.length > 1) {
    throw new Error(`${aliasName} accepts one value; multiple attachments are not supported yet`);
  }
  return preferredValues.at(-1) ?? aliasValues.at(-1);
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

function parseMessageFileType(args: string[]) {
  const raw = parseOptionValue(args, "--file-type");
  if (!raw) {
    return undefined;
  }
  if (
    raw === "auto" ||
    raw === "file" ||
    raw === "image" ||
    raw === "video" ||
    raw === "audio" ||
    raw === "voice"
  ) {
    return raw;
  }
  throw new Error("--file-type must be auto, file, image, video, audio, or voice");
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

function parseMessageChannel(args: string[]): MessageChannel {
  return parseRegisteredChannelOrThrow(parseOptionValue(args, "--channel"));
}

function stripCustomGatewayArgs(args: string[]) {
  const stripped: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--channel" || arg === "--bot" || arg === "--account") {
      index += 1;
      continue;
    }
    if (arg === "--json") {
      continue;
    }
    stripped.push(arg!);
  }
  return stripped;
}

function parseCustomMessageCommand(args: string[]): ParsedCustomMessageCommand | null {
  const rest = args.slice(1);
  const subtreeArgs = stripCustomGatewayArgs(rest);
  if (
    subtreeArgs.length === 0 ||
    subtreeArgs[0] === "--help" ||
    subtreeArgs[0] === "-h" ||
    subtreeArgs[0] === "help"
  ) {
    return null;
  }

  return {
    kind: "custom",
    channel: parseMessageChannel(rest),
    account: parseAliasedOptionValue(rest, "--bot", "--account"),
    json: hasFlag(rest, "--json"),
    subtreeArgs,
  };
}

function parseSharedMessageCommand(args: string[]): ParsedMessageCommand | null {
  const rawAction = args[0];
  if (!rawAction || rawAction === "--help" || rawAction === "-h" || rawAction === "help") {
    return null;
  }
  if (rawAction === "custom") {
    throw new Error("Internal error: custom commands must be parsed separately");
  }
  const action = rawAction as MessageAction;
  const rest = args.slice(1);
  const channel = parseMessageChannel(rest);

  return {
    kind: "shared",
    action,
    channel,
    account: parseAliasedOptionValue(rest, "--bot", "--account"),
    target: parseOptionValue(rest, "--target"),
    childSurface: parseChildSurfaceSelector({
      args: rest,
      channel,
      scopeLabel: "message commands",
    }),
    message: parseOptionValue(rest, "--message") ?? parseOptionValue(rest, "-m"),
    messageFile: parseMessageBodyFileOption(rest),
    media: parseMessageAttachmentOption(rest),
    fileType: parseMessageFileType(rest),
    messageId: parseOptionValue(rest, "--message-id"),
    emoji: parseOptionValue(rest, "--emoji"),
    remove: hasFlag(rest, "--remove"),
    replyTo: parseOptionValue(rest, "--reply-to"),
    limit: parseIntegerOption(rest, "--limit"),
    query: parseOptionValue(rest, "--query"),
    pollQuestion: parseOptionValue(rest, "--poll-question"),
    pollOptions: parseRepeatedOption(rest, "--poll-option"),
    forceDocument: hasFlag(rest, "--force-document"),
    silent: hasFlag(rest, "--silent"),
    progress: hasFlag(rest, "--progress"),
    final: hasFlag(rest, "--final"),
    confirm: hasFlag(rest, "--confirm"),
    json: hasFlag(rest, "--json"),
    inputFormat: parseMessageInputFormat(parseOptionValue(rest, "--input")),
    renderMode: parseMessageRenderMode(parseOptionValue(rest, "--render")),
  };
}

function parseMessageCommand(args: string[]): ParsedMessageCliCommand | null {
  if (args[0] === "custom") {
    return parseCustomMessageCommand(args);
  }
  return parseSharedMessageCommand(args);
}

function renderMessageHelpTargetLines(channel?: MessageChannel) {
  return channel
    ? (getChannelPlugin(channel)?.controlHelp?.message?.targetLines ?? [])
    : [
      `  use ${renderCliCommand(`message --help --channel ${renderChannelNamePlaceholder()}`)} for channel-specific target syntax and examples`,
      "  channel child-surface flags are owned by each channel plugin",
      ...listChannelPlugins().flatMap((plugin) => plugin.controlHelp?.message?.targetLines ?? []),
    ];
}

function renderMessageHelpRenderLines(channel?: MessageChannel) {
  return channel
    ? (getChannelPlugin(channel)?.controlHelp?.message?.renderLines ?? [])
    : listChannelPlugins().flatMap((plugin) => plugin.controlHelp?.message?.renderLines ?? []);
}

function renderMessageHelpLengthGuidanceLines(channel?: MessageChannel) {
  return channel
    ? (getChannelPlugin(channel)?.controlHelp?.message?.lengthGuidanceLines ?? [])
    : listChannelPlugins().flatMap((plugin) => plugin.controlHelp?.message?.lengthGuidanceLines ?? []);
}

function renderMessageHelpExampleLines(channel?: MessageChannel) {
  return channel
    ? (getChannelPlugin(channel)?.controlHelp?.message?.exampleLines ?? [])
    : listChannelPlugins().flatMap((plugin) => plugin.controlHelp?.message?.exampleLines ?? []);
}

function renderMessageHelpThreadingLines(channel?: MessageChannel) {
  if (channel) {
    const plugin = getChannelPlugin(channel);
    if (!plugin?.childSurfaceCli) {
      return [`  ${plugin?.displayName ?? channel} does not support child surfaces`];
    }
    return [`  ${plugin.childSurfaceCli.primaryFlag} <id>`];
  }
  return Array.from(new Set(
    listChannelPlugins()
      .flatMap((plugin) => plugin.childSurfaceCli?.primaryFlag ? [plugin.childSurfaceCli.primaryFlag] : []),
  )).map((flag) => `  ${flag} <id>`);
}

function renderMessageChildSurfaceUsage(channel?: MessageChannel) {
  if (!channel) {
    return " [<channel child-surface flags>]";
  }
  const childSurfaceCli = getChannelPlugin(channel)?.childSurfaceCli;
  return childSurfaceCli ? ` [${childSurfaceCli.primaryFlag} <id>]` : "";
}

export function renderMessageHelp(channel?: MessageChannel) {
  const childSurfaceUsage = renderMessageChildSurfaceUsage(channel);
  return [
    renderCliCommand("message"),
    "",
    "Usage:",
    `  ${renderCliCommand(`message send --channel ${renderChannelNamePlaceholder()} --target <dest>${childSurfaceUsage} [--message <text> | --body-file <path>] [--input <plain|md|html|mrkdwn|blocks>] [--render <native|none|html|mrkdwn|blocks>] [--bot <id>] [--file <path-or-url>] [--file-type auto|file|image|video|audio|voice] [--reply-to <id>] [--force-document] [--silent] [--progress|--final]`)}`,
    `  ${renderCliCommand(`message poll --channel ${renderChannelNamePlaceholder()} --target <dest>${childSurfaceUsage} --poll-question <text> --poll-option <value> [--poll-option <value>] [--bot <id>] [--silent]`)}`,
    `  ${renderCliCommand(`message react --channel ${renderChannelNamePlaceholder()} --target <dest> --message-id <id> --emoji <emoji> [--bot <id>] [--remove]`)}`,
    `  ${renderCliCommand(`message reactions --channel ${renderChannelNamePlaceholder()} --target <dest> --message-id <id> [--bot <id>]`)}`,
    `  ${renderCliCommand(`message read --channel ${renderChannelNamePlaceholder()} --target <dest> [--bot <id>] [--limit <n>]`)}`,
    `  ${renderCliCommand(`message edit --channel ${renderChannelNamePlaceholder()} --target <dest> --message-id <id> [--message <text> | --body-file <path>] [--input <plain|md|html|mrkdwn|blocks>] [--render <native|none|html|mrkdwn|blocks>] [--bot <id>]`)}`,
    `  ${renderCliCommand(`message delete --channel ${renderChannelNamePlaceholder()} --target <dest> --message-id <id> [--bot <id>] [--confirm]`)}`,
    `  ${renderCliCommand(`message pin --channel ${renderChannelNamePlaceholder()} --target <dest> --message-id <id> [--bot <id>]`)}`,
    `  ${renderCliCommand(`message unpin --channel ${renderChannelNamePlaceholder()} --target <dest> [--message-id <id>] [--bot <id>]`)}`,
    `  ${renderCliCommand(`message pins --channel ${renderChannelNamePlaceholder()} --target <dest> [--bot <id>]`)}`,
    `  ${renderCliCommand(`message search --channel ${renderChannelNamePlaceholder()} --target <dest> --query <text> [--bot <id>] [--limit <n>]`)}`,
    `  ${renderCliCommand(`message custom <subtree...> --channel ${renderChannelNamePlaceholder()} [--bot <id>] [--json]`)}`,
    "",
    "Send/Edit Content Options:",
    "  --message <text>              Inline message body",
    "  --body-file <path>            Read the message body from a file",
    "                                Alias: --message-file (compat only)",
    "  --file <path-or-url>          Attach a file or remote URL",
    "                                Alias: --media (compat only)",
    "  --file-type <type>            auto|file|image|video|audio|voice. Default: auto",
    "  --input <plain|md|html|mrkdwn|blocks>",
    "                               Input content format. Default: md",
    "  --render <native|none|html|mrkdwn|blocks>",
    "                               Output rendering mode. Default: native",
    "",
    "Render Rules:",
    "  native                        Channel-owned default rendering",
    ...renderMessageHelpRenderLines(channel),
    "  none                          Content is already destination-native",
    ...(channel ? [] : []),
    "",
    "Length Guidance:",
    ...renderMessageHelpLengthGuidanceLines(channel),
    "",
    "Threading:",
    ...renderMessageHelpThreadingLines(channel),
    "",
    "Targets:",
    ...renderMessageHelpTargetLines(channel),
    "",
    "Capability Rules:",
    "  - shared actions are gated by channel capability truth before provider dispatch",
    "  - `message custom ...` is a channel-owned public subtree when a plugin exposes one",
    "  - `--account` remains a compatibility alias for `--bot`",
    `  - ${renderSupportedChannelsNote()}`,
    "",
    "Examples:",
    ...renderMessageHelpExampleLines(channel),
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

function assertSharedMessageActionSupport(
  plugin: ChannelPlugin,
  command: ParsedMessageCommand,
) {
  if (plugin.capabilities.messageActions.includes(command.action)) {
    return;
  }
  throw new Error(
    `Channel ${plugin.id} does not support message action \`${command.action}\`.`,
  );
}

function assertSharedMessageSurfaceSupport(
  plugin: ChannelPlugin,
  surface: ReturnType<ChannelPlugin["resolveMessageSurface"]>,
) {
  if (!surface) {
    return;
  }
  if (plugin.capabilities.surfaceKinds.includes(surface.surfaceKind)) {
    return;
  }
  throw new Error(`Channel ${plugin.id} does not support ${surface.surfaceKind} surfaces.`);
}

function assertCustomMessageSupport(
  plugin: ChannelPlugin,
  command: ParsedCustomMessageCommand,
) {
  if (plugin.capabilities.supportsMessageCustomSubtree && plugin.runCustomMessageCommand) {
    return;
  }
  throw new Error(
    `Channel ${command.channel} does not expose a custom message subtree.`,
  );
}

export async function runMessageCli(
  args: string[],
  dependencies: MessageCliDependencies = defaultMessageCliDependencies,
) {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    const helpChannel = parseOptionValue(args, "--channel") as MessageChannel | undefined;
    dependencies.print(renderMessageHelp(helpChannel));
    return;
  }

  const command = parseMessageCommand(args);
  if (!command) {
    const helpChannel = parseOptionValue(args, "--channel") as MessageChannel | undefined;
    dependencies.print(renderMessageHelp(helpChannel));
    return;
  }
  const plugin = dependencies.plugins.find((entry) => entry.id === command.channel);
  if (!plugin) {
    throw new Error(`Unsupported message channel: ${command.channel}`);
  }

  if (command.kind === "custom") {
    assertCustomMessageSupport(plugin, command);
    const loadedConfig = await dependencies.loadConfig(getConfigPath(), {
      materializeChannels: [command.channel],
    });
    const result = await plugin.runCustomMessageCommand!(loadedConfig, command);
    if (command.json) {
      dependencies.print(JSON.stringify(result, null, 2));
      return;
    }
    dependencies.print(JSON.stringify(result, null, 2));
    return;
  }

  const resolvedCommand = await resolveCommandMessage(command);
  if (resolvedCommand.progress && resolvedCommand.final) {
    throw new Error("--progress and --final cannot be used together");
  }
  assertTarget(resolvedCommand);
  assertSharedMessageActionSupport(plugin, resolvedCommand);
  const surface = plugin.resolveMessageSurface(resolvedCommand);
  assertSharedMessageSurfaceSupport(plugin, surface);

  const loadedConfig = await dependencies.loadConfig(getConfigPath(), {
    materializeChannels: [resolvedCommand.channel],
  });
  const execution = await plugin.runMessageCommand(loadedConfig, resolvedCommand, surface);
  const replyTarget =
    resolvedCommand.action === "send" || resolvedCommand.action === "poll"
      ? plugin.resolveMessageReplyTarget({
          loadedConfig,
          command: resolvedCommand,
          surface,
          botId: execution.botId,
        })
      : null;
  if (replyTarget) {
    await dependencies.recordConversationReply({
      loadedConfig,
      target: replyTarget,
      kind: resolveReplyKind(resolvedCommand),
      source: "message-tool",
    });
  }

  if (resolvedCommand.json) {
    dependencies.print(JSON.stringify(execution.result, null, 2));
    return;
  }

  dependencies.print(JSON.stringify(execution.result, null, 2));
}
