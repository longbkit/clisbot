import { readEditableConfig, writeEditableConfig } from "../config/config-file.ts";
import {
  renderGenericPrivilegeCommandHelpLines,
  renderPrivilegeCommandHelpLines,
} from "../channels/privilege-help.ts";
import {
  getConfiguredAdditionalMessageMode,
  setConfiguredAdditionalMessageMode,
} from "../channels/additional-message-mode-config.ts";
import {
  getConfiguredResponseMode,
  setConfiguredResponseMode,
} from "../channels/response-mode-config.ts";
import type {
  AdditionalMessageMode,
  ResponseMode,
} from "../channels/mode-config-shared.ts";
import { runChannelPrivilegeCli } from "./channel-privilege-cli.ts";
import { renderChannelSetupHelpLines } from "./startup-bootstrap.ts";

type ChannelId = "slack" | "telegram";
type ChannelAction = "enable" | "disable";
type TokenTarget = "slack-app" | "slack-bot" | "telegram-bot";

function getEditableConfigPath() {
  return process.env.CLISBOT_CONFIG_PATH;
}

export function renderChannelsHelp() {
  return [
    "clisbot channels",
    "",
    "Usage:",
    "  clisbot channels",
    "  clisbot channels --help",
    "  clisbot channels enable <slack|telegram>",
    "  clisbot channels disable <slack|telegram>",
    "  clisbot channels add telegram-group <chatId> [--topic <topicId>] [--agent <id>] [--require-mention true|false]",
    "  clisbot channels remove telegram-group <chatId> [--topic <topicId>]",
    "  clisbot channels add slack-channel <channelId> [--agent <id>] [--require-mention true|false]",
    "  clisbot channels remove slack-channel <channelId>",
    "  clisbot channels add slack-group <groupId> [--agent <id>] [--require-mention true|false]",
    "  clisbot channels remove slack-group <groupId>",
    "  clisbot channels privilege <enable|disable|allow-user|remove-user> <target> ...",
    "  clisbot channels response-mode status --channel <slack|telegram> [--target <target>] [--topic <topicId>]",
    "  clisbot channels response-mode set <capture-pane|message-tool> --channel <slack|telegram> [--target <target>] [--topic <topicId>]",
    "  clisbot channels additional-message-mode status --channel <slack|telegram> [--target <target>] [--topic <topicId>]",
    "  clisbot channels additional-message-mode set <queue|steer> --channel <slack|telegram> [--target <target>] [--topic <topicId>]",
    "  clisbot channels set-token <slack-app|slack-bot|telegram-bot> <value>",
    "  clisbot channels clear-token <slack-app|slack-bot|telegram-bot>",
    "",
    "Policy guide:",
    "  - Slack DMs still follow channels.slack.directMessages.policy",
    "  - Telegram DMs still follow channels.telegram.directMessages.policy",
    "  - Slack public channels need channels.slack.channels.<channelId>",
    "  - Slack private groups need channels.slack.groups.<groupId>",
    "  - Telegram groups need channels.telegram.groups.<chatId>",
    "  - Telegram forum topics need channels.telegram.groups.<chatId>.topics.<topicId>",
    "  - Adding a route puts that surface on the allowlist; other channels, groups, or topics still need to be added explicitly",
    "  - Tune route settings such as requireMention, privilegeCommands, and followUp in clisbot.json when a surface should behave differently",
    "  - Response delivery can be tuned with responseMode: `capture-pane` or `message-tool`",
    "  - Busy-session follow-up can be tuned with additionalMessageMode: `steer` or `queue`",
    "  - Slack response-mode targets use `channel:<id>`, `group:<id>`, or `dm:<id>`",
    "  - Slack additional-message-mode targets use `channel:<id>`, `group:<id>`, or `dm:<id>`",
    "  - Telegram response-mode targets use a numeric chat id; negative ids are groups, positive ids are direct messages",
    "  - Telegram additional-message-mode targets use a numeric chat id; negative ids are groups, positive ids are direct messages",
    "  - Telegram topics add `--topic <topicId>` on top of the group chat id",
    "  - Use pairing or allowlist DM policy when you do not want open direct-message access",
    "",
    "Response mode examples:",
    "  - clisbot channels response-mode status --channel slack",
    "  - clisbot channels response-mode set message-tool --channel slack --target channel:C123",
    "  - clisbot channels response-mode set capture-pane --channel slack --target group:G123",
    "  - clisbot channels response-mode set message-tool --channel slack --target dm:D123",
    "  - clisbot channels response-mode set message-tool --channel telegram --target -1001234567890",
    "  - clisbot channels response-mode set capture-pane --channel telegram --target -1001234567890 --topic 42",
    "  - clisbot channels response-mode set message-tool --channel telegram --target 123456789",
    "  - clisbot channels additional-message-mode status --channel slack --target channel:C123",
    "  - clisbot channels additional-message-mode set steer --channel slack --target channel:C123",
    "  - clisbot channels additional-message-mode set queue --channel slack --target group:G123",
    "  - clisbot channels additional-message-mode set steer --channel slack --target dm:D123",
    "  - clisbot channels additional-message-mode set steer --channel telegram --target -1001234567890",
    "  - clisbot channels additional-message-mode set queue --channel telegram --target -1001234567890 --topic 42",
    "  - clisbot channels additional-message-mode set steer --channel telegram --target 123456789",
    "",
    "Discovery tips:",
    "  - Telegram: use `/whoami` in the target group or topic to get chatId and topicId",
    "  - Slack: get channelId or groupId from the Slack conversation link",
    "",
    "Next steps:",
    "  - Run `clisbot status` to inspect routes and current channel state",
    "  - Run `clisbot logs` if the bot is still not responding",
    ...renderGenericPrivilegeCommandHelpLines(),
    ...renderChannelSetupHelpLines("", { includePrivilegeHelp: false }),
  ].join("\n");
}

function parseChannelId(raw: string | undefined): ChannelId {
  if (raw === "slack" || raw === "telegram") {
    return raw;
  }

  throw new Error("Usage: clisbot channels <enable|disable> <slack|telegram>");
}

function parseChannelAction(raw: string | undefined): ChannelAction {
  if (raw === "enable" || raw === "disable") {
    return raw;
  }

  throw new Error("Usage: clisbot channels <enable|disable> <slack|telegram>");
}

function parseTokenTarget(raw: string | undefined): TokenTarget {
  if (raw === "slack-app" || raw === "slack-bot" || raw === "telegram-bot") {
    return raw;
  }

  throw new Error(
    "Usage: clisbot channels <set-token|clear-token> <slack-app|slack-bot|telegram-bot> [value]",
  );
}

function parseResponseMode(raw: string | undefined): ResponseMode {
  if (raw === "capture-pane" || raw === "message-tool") {
    return raw;
  }
  throw new Error(renderChannelsHelp());
}

function parseAdditionalMessageMode(raw: string | undefined): AdditionalMessageMode {
  if (raw === "queue" || raw === "steer") {
    return raw;
  }
  throw new Error(renderChannelsHelp());
}

function parseResponseModeChannel(raw: string | undefined) {
  if (raw === "slack" || raw === "telegram") {
    return raw;
  }
  throw new Error("response-mode requires --channel slack or --channel telegram");
}

function parseResponseModeTarget(channel: "slack" | "telegram", raw: string | undefined) {
  if (!raw) {
    return undefined;
  }

  const target = raw.trim();
  if (!target) {
    throw new Error("--target requires a value");
  }

  if (channel === "slack") {
    const [kind, targetId] = target.split(":", 2);
    if (
      (kind === "channel" || kind === "group" || kind === "dm") &&
      targetId?.trim()
    ) {
      return `${kind}:${targetId.trim()}`;
    }
    throw new Error("Slack --target must use channel:<id>, group:<id>, or dm:<id>");
  }

  if (!/^-?\d+$/.test(target)) {
    throw new Error("Telegram --target must be a numeric chat id");
  }

  return target;
}

function parseOptionValue(args: string[], name: string) {
  const index = args.findIndex((arg) => arg === name);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1]?.trim();
  if (!value) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
}

function parseBooleanOption(args: string[], name: string, fallback: boolean) {
  const raw = parseOptionValue(args, name);
  if (!raw) {
    return fallback;
  }

  if (raw === "true") {
    return true;
  }

  if (raw === "false") {
    return false;
  }

  throw new Error(`${name} requires true or false`);
}

function getAgentId(args: string[]) {
  return parseOptionValue(args, "--agent") ?? "default";
}

async function setChannelEnabled(action: ChannelAction, channel: ChannelId) {
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const enabled = action === "enable";
  const current = config.channels[channel].enabled;

  if (current === enabled) {
    console.log(`${channel} is already ${enabled ? "enabled" : "disabled"}`);
    console.log(`config: ${configPath}`);
    renderPostChangeGuidance(action, channel);
    return;
  }

  config.channels[channel].enabled = enabled;
  await writeEditableConfig(configPath, config);
  console.log(`${enabled ? "enabled" : "disabled"} ${channel}`);
  console.log(`config: ${configPath}`);
  renderPostChangeGuidance(action, channel);
}

async function addTelegramGroup(args: string[]) {
  const chatId = args[0]?.trim();
  if (!chatId) {
    throw new Error(
      "Usage: clisbot channels add telegram-group <chatId> [--topic <topicId>] [--agent <id>] [--require-mention true|false]",
    );
  }

  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const topicId = parseOptionValue(args, "--topic");
  const agentId = getAgentId(args);
  const requireMention = parseBooleanOption(args, "--require-mention", true);
  const groupRoute = config.channels.telegram.groups[chatId] ?? {
    agentId,
    requireMention,
    topics: {},
  };

  if (topicId) {
    config.channels.telegram.groups[chatId] = {
      ...groupRoute,
      topics: {
        ...(groupRoute.topics ?? {}),
        [topicId]: {
          ...(groupRoute.topics?.[topicId] ?? {}),
          agentId,
          requireMention,
        },
      },
    };
    await writeEditableConfig(configPath, config);
    console.log(`added telegram topic route ${chatId}/${topicId}`);
    console.log(`config: ${configPath}`);
    renderSuccessBanner();
    renderRouteAddGuidance({
      channel: "telegram",
      kind: "topic",
      routeId: `${chatId}/${topicId}`,
    });
    return;
  }

  config.channels.telegram.groups[chatId] = {
    ...groupRoute,
    agentId,
    requireMention,
    topics: groupRoute.topics ?? {},
  };
  await writeEditableConfig(configPath, config);
  console.log(`added telegram group route ${chatId}`);
  console.log(`config: ${configPath}`);
  renderSuccessBanner();
  renderRouteAddGuidance({
    channel: "telegram",
    kind: "group",
    routeId: chatId,
  });
}

async function removeTelegramGroup(args: string[]) {
  const chatId = args[0]?.trim();
  if (!chatId) {
    throw new Error(
      "Usage: clisbot channels remove telegram-group <chatId> [--topic <topicId>]",
    );
  }

  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const topicId = parseOptionValue(args, "--topic");
  const groupRoute = config.channels.telegram.groups[chatId];

  if (!groupRoute) {
    console.log(`telegram group route ${chatId} is not configured`);
    console.log(`config: ${configPath}`);
    return;
  }

  if (topicId) {
    if (!groupRoute.topics?.[topicId]) {
      console.log(`telegram topic route ${chatId}/${topicId} is not configured`);
      console.log(`config: ${configPath}`);
      return;
    }

    delete groupRoute.topics[topicId];
    await writeEditableConfig(configPath, config);
    console.log(`removed telegram topic route ${chatId}/${topicId}`);
    console.log(`config: ${configPath}`);
    return;
  }

  delete config.channels.telegram.groups[chatId];
  await writeEditableConfig(configPath, config);
  console.log(`removed telegram group route ${chatId}`);
  console.log(`config: ${configPath}`);
}

async function addSlackRoute(kind: "channel" | "group", args: string[]) {
  const routeId = args[0]?.trim();
  if (!routeId) {
    throw new Error(
      `Usage: clisbot channels add slack-${kind} <${kind}Id> [--agent <id>] [--require-mention true|false]`,
    );
  }

  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const agentId = getAgentId(args);
  const requireMention = parseBooleanOption(args, "--require-mention", false);
  const target = kind === "channel"
    ? config.channels.slack.channels
    : config.channels.slack.groups;

  target[routeId] = {
    ...(target[routeId] ?? {}),
    agentId,
    requireMention,
  };
  await writeEditableConfig(configPath, config);
  console.log(`added slack ${kind} route ${routeId}`);
  console.log(`config: ${configPath}`);
  renderSuccessBanner();
  renderRouteAddGuidance({
    channel: "slack",
    kind,
    routeId,
  });
}

async function removeSlackRoute(kind: "channel" | "group", args: string[]) {
  const routeId = args[0]?.trim();
  if (!routeId) {
    throw new Error(`Usage: clisbot channels remove slack-${kind} <${kind}Id>`);
  }

  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const target = kind === "channel"
    ? config.channels.slack.channels
    : config.channels.slack.groups;

  if (!target[routeId]) {
    console.log(`slack ${kind} route ${routeId} is not configured`);
    console.log(`config: ${configPath}`);
    return;
  }

  delete target[routeId];
  await writeEditableConfig(configPath, config);
  console.log(`removed slack ${kind} route ${routeId}`);
  console.log(`config: ${configPath}`);
}

async function setToken(target: TokenTarget, value: string) {
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());

  if (target === "slack-app") {
    config.channels.slack.appToken = value;
    const defaultAccountId = config.channels.slack.defaultAccount || "default";
    const existing = config.channels.slack.accounts[defaultAccountId];
    config.channels.slack.accounts[defaultAccountId] = {
      appToken: value,
      botToken: existing?.botToken ?? config.channels.slack.botToken,
    };
  } else if (target === "slack-bot") {
    config.channels.slack.botToken = value;
    const defaultAccountId = config.channels.slack.defaultAccount || "default";
    const existing = config.channels.slack.accounts[defaultAccountId];
    config.channels.slack.accounts[defaultAccountId] = {
      appToken: existing?.appToken ?? config.channels.slack.appToken,
      botToken: value,
    };
  } else {
    config.channels.telegram.botToken = value;
    const defaultAccountId = config.channels.telegram.defaultAccount || "default";
    config.channels.telegram.accounts[defaultAccountId] = {
      botToken: value,
    };
  }

  await writeEditableConfig(configPath, config);
  console.log(`updated ${target} token reference`);
  console.log(`config: ${configPath}`);
}

async function clearToken(target: TokenTarget) {
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());

  if (target === "slack-app") {
    config.channels.slack.appToken = "";
    const defaultAccountId = config.channels.slack.defaultAccount || "default";
    const existing = config.channels.slack.accounts[defaultAccountId];
    if (existing) {
      config.channels.slack.accounts[defaultAccountId] = {
        appToken: "",
        botToken: existing.botToken,
      };
    }
  } else if (target === "slack-bot") {
    config.channels.slack.botToken = "";
    const defaultAccountId = config.channels.slack.defaultAccount || "default";
    const existing = config.channels.slack.accounts[defaultAccountId];
    if (existing) {
      config.channels.slack.accounts[defaultAccountId] = {
        appToken: existing.appToken,
        botToken: "",
      };
    }
  } else {
    config.channels.telegram.botToken = "";
    const defaultAccountId = config.channels.telegram.defaultAccount || "default";
    if (config.channels.telegram.accounts[defaultAccountId]) {
      config.channels.telegram.accounts[defaultAccountId] = {
        botToken: "",
      };
    }
  }

  await writeEditableConfig(configPath, config);
  console.log(`cleared ${target} token reference`);
  console.log(`config: ${configPath}`);
}

async function runResponseModeCli(args: string[]) {
  const action = args[0];
  if (action !== "status" && action !== "set") {
    throw new Error(renderChannelsHelp());
  }

  const responseMode = action === "set" ? parseResponseMode(args[1]) : undefined;
  const optionArgs = action === "set" ? args.slice(2) : args.slice(1);
  const channel = parseResponseModeChannel(parseOptionValue(optionArgs, "--channel"));
  const target = parseResponseModeTarget(channel, parseOptionValue(optionArgs, "--target"));
  const topic = parseOptionValue(optionArgs, "--topic");

  if (channel === "slack" && topic) {
    throw new Error("Slack response-mode commands do not support --topic");
  }

  if (action === "status") {
    const status = await getConfiguredResponseMode({
      channel,
      target,
      topic,
    });
    console.log(`responseMode target: ${status.label}`);
    console.log(`responseMode: ${status.responseMode ?? "(inherit)"}`);
    console.log(`config: ${status.configPath}`);
    return;
  }

  const updated = await setConfiguredResponseMode({
    channel,
    target,
    topic,
    responseMode: responseMode!,
  });
  console.log(`updated responseMode for ${updated.label}`);
  console.log(`responseMode: ${updated.responseMode}`);
  console.log(`config: ${updated.configPath}`);
}

async function runAdditionalMessageModeCli(args: string[]) {
  const action = args[0];
  if (action !== "status" && action !== "set") {
    throw new Error(renderChannelsHelp());
  }

  const additionalMessageMode =
    action === "set" ? parseAdditionalMessageMode(args[1]) : undefined;
  const optionArgs = action === "set" ? args.slice(2) : args.slice(1);
  const channel = parseResponseModeChannel(parseOptionValue(optionArgs, "--channel"));
  const target = parseResponseModeTarget(channel, parseOptionValue(optionArgs, "--target"));
  const topic = parseOptionValue(optionArgs, "--topic");

  if (channel === "slack" && topic) {
    throw new Error("Slack additional-message-mode commands do not support --topic");
  }

  if (action === "status") {
    const status = await getConfiguredAdditionalMessageMode({
      channel,
      target,
      topic,
    });
    console.log(`additionalMessageMode target: ${status.label}`);
    console.log(`additionalMessageMode: ${status.additionalMessageMode ?? "(inherit)"}`);
    console.log(`config: ${status.configPath}`);
    return;
  }

  const updated = await setConfiguredAdditionalMessageMode({
    channel,
    target,
    topic,
    additionalMessageMode: additionalMessageMode!,
  });
  console.log(`updated additionalMessageMode for ${updated.label}`);
  console.log(`additionalMessageMode: ${updated.additionalMessageMode}`);
  console.log(`config: ${updated.configPath}`);
}

function renderPostChangeGuidance(action: ChannelAction, channel: ChannelId) {
  if (action === "disable") {
    console.log("Run `clisbot status` to confirm the runtime state after config reload.");
    return;
  }

  if (channel === "slack") {
    console.log("Slack next steps:");
    console.log("  - direct messages still follow channels.slack.directMessages.policy");
    console.log("  - public channels need channels.slack.channels.<channelId>");
    console.log("  - private groups need channels.slack.groups.<groupId>");
    console.log("  - get channelId or groupId from the Slack conversation link");
  } else {
    console.log("Telegram next steps:");
    console.log("  - direct messages still follow channels.telegram.directMessages.policy");
    console.log("  - groups need channels.telegram.groups.<chatId>");
    console.log("  - forum topics need channels.telegram.groups.<chatId>.topics.<topicId>");
    console.log("  - use `/whoami` inside Telegram to get chatId and topicId");
  }

  console.log("Run `clisbot status` to inspect routes and current channel state.");
  console.log("Run `clisbot logs` if the bot is still not responding.");
  for (const line of renderChannelSetupHelpLines()) {
    console.log(line);
  }
}

function renderSuccessBanner() {
  console.log("");
  console.log("+---------+");
  console.log("| SUCCESS |");
  console.log("+---------+");
  console.log("");
}

function renderRouteAddGuidance(params: {
  channel: "slack" | "telegram";
  kind: "channel" | "group" | "topic";
  routeId: string;
}) {
  if (params.channel === "slack") {
    const routeLabel = params.kind === "channel" ? "channel" : "group";
    const routePath = params.kind === "channel"
      ? `channels.slack.channels."${params.routeId}"`
      : `channels.slack.groups."${params.routeId}"`;

    console.log("Slack route next steps:");
    console.log(`  - route added: ${routePath}`);
    console.log(
      "  - direct messages still follow channels.slack.directMessages.policy (`open`, `pairing`, `allowlist`, or `disabled`)",
    );
    console.log(
      `  - this ${routeLabel} still follows channels.slack.groupPolicy and route settings such as requireMention, privilegeCommands, and followUp`,
    );
    console.log(
      "  - if you want pairing-style access control for DMs, set channels.slack.directMessages.policy to `pairing`",
    );
    console.log(
      "  - if you want stricter route access, keep Slack groups on allowlist and only add the channels/groups you trust",
    );
    for (const line of renderPrivilegeCommandHelpLines({
      platform: "slack",
      conversationKind: params.kind === "group" ? "group" : "channel",
      channelId: params.routeId,
    }, "  ")) {
      console.log(line);
    }
  } else {
    const [chatId, topicId] = params.routeId.split("/");
    const routePath = params.kind === "topic"
      ? `channels.telegram.groups."${chatId}".topics."${topicId}"`
      : `channels.telegram.groups."${params.routeId}"`;

    console.log("Telegram route next steps:");
    console.log(`  - route added: ${routePath}`);
    console.log(
      "  - direct messages still follow channels.telegram.directMessages.policy (`open`, `pairing`, `allowlist`, or `disabled`)",
    );
    console.log(
      `  - this ${params.kind} is now on the Telegram allowlist; other groups or topics still need to be added explicitly`,
    );
    console.log(
      "  - if you want pairing-style access control for DMs, set channels.telegram.directMessages.policy to `pairing`",
    );
    console.log(
      "  - tune route settings such as requireMention, privilegeCommands, and followUp in clisbot.json if this surface should behave differently",
    );
    for (const line of renderPrivilegeCommandHelpLines({
      platform: "telegram",
      conversationKind: params.kind === "topic" ? "topic" : "group",
      chatId: chatId ?? params.routeId,
      topicId,
    }, "  ")) {
      console.log(line);
    }
  }

  console.log("Run `clisbot status` to inspect routes and current channel state.");
  console.log("Run `clisbot logs` if the bot is still not responding.");
  for (const line of renderChannelSetupHelpLines()) {
    console.log(line);
  }
}

export async function runChannelsCli(args: string[]) {
  const command = args[0];

  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(renderChannelsHelp());
    return;
  }

  if (command === "enable" || command === "disable") {
    const channel = parseChannelId(args[1]);
    await setChannelEnabled(command, channel);
    return;
  }

  if (command === "add") {
    const target = args[1];
    const rest = args.slice(2);
    if (target === "telegram-group") {
      await addTelegramGroup(rest);
      return;
    }
    if (target === "slack-channel") {
      await addSlackRoute("channel", rest);
      return;
    }
    if (target === "slack-group") {
      await addSlackRoute("group", rest);
      return;
    }
  }

  if (command === "privilege") {
    await runChannelPrivilegeCli(args.slice(1));
    return;
  }

  if (command === "response-mode") {
    await runResponseModeCli(args.slice(1));
    return;
  }

  if (command === "additional-message-mode") {
    await runAdditionalMessageModeCli(args.slice(1));
    return;
  }

  if (command === "remove") {
    const target = args[1];
    const rest = args.slice(2);
    if (target === "telegram-group") {
      await removeTelegramGroup(rest);
      return;
    }
    if (target === "slack-channel") {
      await removeSlackRoute("channel", rest);
      return;
    }
    if (target === "slack-group") {
      await removeSlackRoute("group", rest);
      return;
    }
  }

  if (command === "set-token") {
    const target = parseTokenTarget(args[1]);
    const value = args[2]?.trim();
    if (!value) {
      throw new Error(
        "Usage: clisbot channels set-token <slack-app|slack-bot|telegram-bot> <value>",
      );
    }
    await setToken(target, value);
    return;
  }

  if (command === "clear-token") {
    const target = parseTokenTarget(args[1]);
    await clearToken(target);
    return;
  }

  throw new Error(renderChannelsHelp());
}
