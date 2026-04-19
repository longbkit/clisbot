import { readEditableConfig, writeEditableConfig } from "../config/config-file.ts";
import type {
  BotRouteConfig,
  ClisbotConfig,
  TelegramBotConfig,
} from "../config/schema.ts";
import {
  createDirectMessageBehaviorOverride,
  ensureBotDirectMessageWildcardRoute,
  isDirectMessageWildcardRouteId,
  isExactDirectMessageRouteId,
} from "../config/direct-message-routes.ts";
import { renderCliCommand } from "../shared/cli-name.ts";

type Provider = "slack" | "telegram";
type RouteNode = BotRouteConfig | TelegramBotConfig["groups"][string] | TelegramBotConfig["groups"][string]["topics"][string];

function getEditableConfigPath() {
  return process.env.CLISBOT_CONFIG_PATH;
}

function getSlackBots(config: ClisbotConfig) {
  const { defaults, ...bots } = config.bots.slack;
  return bots;
}

function getTelegramBots(config: ClisbotConfig) {
  const { defaults, ...bots } = config.bots.telegram;
  return bots;
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

function hasFlag(args: string[], name: string) {
  return args.includes(name);
}

const ROUTE_ARGUMENT_FLAGS = new Set([
  "--channel",
  "--bot",
  "--policy",
  "--require-mention",
  "--allow-bots",
  "--agent",
  "--value",
  "--mode",
  "--minutes",
  "--user",
]);

function findRouteArgument(args: string[]) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }
    if (ROUTE_ARGUMENT_FLAGS.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      continue;
    }
    return arg;
  }

  return undefined;
}

function parseBoolean(value: string | undefined, fallback?: boolean) {
  if (value === undefined) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error("Expected true or false.");
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error("Expected true or false.");
}

function parseProvider(args: string[]) {
  const channel = parseOptionValue(args, "--channel");
  if (channel === "slack" || channel === "telegram") {
    return channel;
  }
  throw new Error(renderRoutesHelp());
}

function parseOptionalProvider(args: string[]) {
  const channel = parseOptionValue(args, "--channel");
  if (channel === undefined) {
    return undefined;
  }
  if (channel === "slack" || channel === "telegram") {
    return channel;
  }
  throw new Error(renderRoutesHelp());
}

function getBotId(args: string[]) {
  return parseOptionValue(args, "--bot") ?? "default";
}

function getSlackBot(config: ClisbotConfig, botId: string) {
  return config.bots.slack[botId];
}

function getTelegramBot(config: ClisbotConfig, botId: string) {
  return config.bots.telegram[botId];
}

function ensureSlackBot(config: ClisbotConfig, botId: string) {
  const bot = getSlackBot(config, botId);
  if (!bot) {
    throw new Error(`Unknown Slack bot: ${botId}`);
  }
  return bot;
}

function ensureTelegramBot(config: ClisbotConfig, botId: string) {
  const bot = getTelegramBot(config, botId);
  if (!bot) {
    throw new Error(`Unknown Telegram bot: ${botId}`);
  }
  return bot;
}

type ParsedRouteId =
  | { provider: "slack"; routeId: string; storage: "groups"; key: string; kind: "channel" | "group" | "dm" }
  | { provider: "telegram"; routeId: string; storage: "groups"; key: string; topicId?: string; kind: "group" | "topic" }
  | { provider: "telegram"; routeId: string; storage: "directMessages"; key: string; kind: "dm" }
  | { provider: "slack"; routeId: string; storage: "directMessages"; key: string; kind: "dm" };

function parseRouteId(provider: Provider, raw: string | undefined): ParsedRouteId {
  const routeId = raw?.trim();
  if (!routeId) {
    throw new Error(renderRoutesHelp());
  }

  if (provider === "slack") {
    const [kind, id] = routeId.split(":", 2);
    if ((kind === "channel" || kind === "group" || kind === "dm") && id?.trim()) {
      if (kind === "dm") {
        return { provider, routeId, storage: "directMessages", key: routeId, kind };
      }
      return { provider, routeId, storage: "groups", key: routeId, kind };
    }
    throw new Error("Slack route ids must use channel:<id>, group:<id>, or dm:<id|*>.");
  }

  const [kind, first, second] = routeId.split(":", 3);
  if (kind === "group" && first?.trim()) {
    return { provider, routeId, storage: "groups", key: first.trim(), kind };
  }
  if (kind === "topic" && first?.trim() && second?.trim()) {
    return {
      provider,
      routeId,
      storage: "groups",
      key: first.trim(),
      topicId: second.trim(),
      kind: "topic",
    };
  }
  if (kind === "dm" && first?.trim()) {
    return { provider, routeId, storage: "directMessages", key: routeId, kind: "dm" };
  }
  throw new Error("Telegram route ids must use group:<chatId>, topic:<chatId>:<topicId>, or dm:<id|*>.");
}

function parseCommandRoute(args: string[], provider: Provider) {
  return parseRouteId(provider, findRouteArgument(args));
}

function isExactDirectMessageRoute(parsed: ParsedRouteId) {
  return parsed.storage === "directMessages" && isExactDirectMessageRouteId(parsed.routeId);
}

function rejectExactDirectMessageAdmissionChange(parsed: ParsedRouteId, action: string) {
  if (!isExactDirectMessageRoute(parsed)) {
    return;
  }

  throw new Error(
    `Direct-message admission for ${parsed.routeId} is managed on dm:* only. ${action} is not allowed on exact DM routes.`,
  );
}

function createBaseRoute(kind: ParsedRouteId["kind"], policy?: string): BotRouteConfig {
  const route: BotRouteConfig = {
    enabled: true,
    requireMention: kind === "dm" ? false : true,
    allowUsers: [],
    blockUsers: [],
    allowBots: false,
  };
  if (policy) {
    route.policy = policy as BotRouteConfig["policy"];
  }
  return route;
}

function createRouteConfig(parsed: ParsedRouteId, policy?: string) {
  if (isExactDirectMessageRoute(parsed)) {
    if (policy) {
      rejectExactDirectMessageAdmissionChange(parsed, "Setting policy");
    }
    return createDirectMessageBehaviorOverride();
  }
  return createBaseRoute(parsed.kind, policy);
}

function getOrCreateRoute(
  config: ClisbotConfig,
  provider: Provider,
  botId: string,
  parsed: ParsedRouteId,
  options: { create?: boolean; policy?: string } = {},
): RouteNode | undefined {
  if (provider === "slack") {
    const bot = ensureSlackBot(config, botId);
    if (parsed.storage === "directMessages") {
      if (!bot.directMessages[parsed.key] && options.create) {
        bot.directMessages[parsed.key] = createRouteConfig(parsed, options.policy);
      }
      return bot.directMessages[parsed.key];
    }
    if (!bot.groups[parsed.key] && options.create) {
      bot.groups[parsed.key] = createBaseRoute(parsed.kind, options.policy);
    }
    return bot.groups[parsed.key];
  }

  const bot = ensureTelegramBot(config, botId);
  if (parsed.storage === "directMessages") {
    if (!bot.directMessages[parsed.key] && options.create) {
      bot.directMessages[parsed.key] = createRouteConfig(parsed, options.policy);
    }
    return bot.directMessages[parsed.key];
  }

  if (!bot.groups[parsed.key] && options.create) {
    bot.groups[parsed.key] = {
      ...createBaseRoute(parsed.kind, parsed.kind === "group" ? options.policy : "disabled"),
      topics: {},
    };
  }
  const group = bot.groups[parsed.key];
  if (!group) {
    return undefined;
  }
  if (!("topicId" in parsed) || !parsed.topicId) {
    return group;
  }
  if (!group.topics[parsed.topicId] && options.create) {
    group.topics[parsed.topicId] = createBaseRoute(parsed.kind, options.policy);
  }
  return group.topics[parsed.topicId];
}

function ensureRoute(
  config: ClisbotConfig,
  provider: Provider,
  botId: string,
  parsed: ParsedRouteId,
) {
  const route = getOrCreateRoute(config, provider, botId, parsed);
  if (!route) {
    throw new Error(`Unknown route: ${provider}/${botId}/${parsed.routeId}`);
  }
  return route;
}

function renderRoutesHelp() {
  return [
    renderCliCommand("routes"),
    "",
    "Usage:",
    `  ${renderCliCommand("routes --help")}`,
    `  ${renderCliCommand("routes help")}`,
    `  ${renderCliCommand("routes list [--channel <slack|telegram>] [--bot <id>] [--json]")}`,
    `  ${renderCliCommand("routes add --channel slack <route-id> [--bot <id>] [--policy <...>] [--require-mention <true|false>] [--allow-bots <true|false>]")}`,
    `  ${renderCliCommand("routes add --channel telegram <route-id> [--bot <id>] [--policy <...>] [--require-mention <true|false>] [--allow-bots <true|false>]")}`,
    `  ${renderCliCommand("routes get --channel <slack|telegram> <route-id> [--bot <id>] [--json]")}`,
    `  ${renderCliCommand("routes enable --channel <slack|telegram> <route-id> [--bot <id>]")}`,
    `  ${renderCliCommand("routes disable --channel <slack|telegram> <route-id> [--bot <id>]")}`,
    `  ${renderCliCommand("routes remove --channel <slack|telegram> <route-id> [--bot <id>]")}`,
    `  ${renderCliCommand("routes get-agent --channel <slack|telegram> <route-id> [--bot <id>]")}`,
    `  ${renderCliCommand("routes set-agent --channel <slack|telegram> <route-id> [--bot <id>] --agent <id>")}`,
    `  ${renderCliCommand("routes clear-agent --channel <slack|telegram> <route-id> [--bot <id>]")}`,
    `  ${renderCliCommand("routes get-policy --channel <slack|telegram> <route-id> [--bot <id>]")}`,
    `  ${renderCliCommand("routes set-policy --channel <slack|telegram> <route-id> [--bot <id>] --policy <...>")}`,
    `  ${renderCliCommand("routes get-require-mention --channel <slack|telegram> <route-id> [--bot <id>]")}`,
    `  ${renderCliCommand("routes set-require-mention --channel <slack|telegram> <route-id> [--bot <id>] --value <true|false>")}`,
    `  ${renderCliCommand("routes get-allow-bots --channel <slack|telegram> <route-id> [--bot <id>]")}`,
    `  ${renderCliCommand("routes set-allow-bots --channel <slack|telegram> <route-id> [--bot <id>] --value <true|false>")}`,
    `  ${renderCliCommand("routes add-allow-user --channel <slack|telegram> <route-id> [--bot <id>] --user <principal>")}`,
    `  ${renderCliCommand("routes remove-allow-user --channel <slack|telegram> <route-id> [--bot <id>] --user <principal>")}`,
    `  ${renderCliCommand("routes add-block-user --channel <slack|telegram> <route-id> [--bot <id>] --user <principal>")}`,
    `  ${renderCliCommand("routes remove-block-user --channel <slack|telegram> <route-id> [--bot <id>] --user <principal>")}`,
    `  ${renderCliCommand("routes get-follow-up-mode --channel <slack|telegram> <route-id> [--bot <id>]")}`,
    `  ${renderCliCommand("routes set-follow-up-mode --channel <slack|telegram> <route-id> [--bot <id>] --mode <auto|mention-only|paused>")}`,
    `  ${renderCliCommand("routes get-follow-up-ttl --channel <slack|telegram> <route-id> [--bot <id>]")}`,
    `  ${renderCliCommand("routes set-follow-up-ttl --channel <slack|telegram> <route-id> [--bot <id>] --minutes <n>")}`,
    `  ${renderCliCommand("routes get-response-mode --channel <slack|telegram> <route-id> [--bot <id>]")}`,
    `  ${renderCliCommand("routes set-response-mode --channel <slack|telegram> <route-id> [--bot <id>] --mode <capture-pane|message-tool>")}`,
    `  ${renderCliCommand("routes clear-response-mode --channel <slack|telegram> <route-id> [--bot <id>]")}`,
    `  ${renderCliCommand("routes get-additional-message-mode --channel <slack|telegram> <route-id> [--bot <id>]")}`,
    `  ${renderCliCommand("routes set-additional-message-mode --channel <slack|telegram> <route-id> [--bot <id>] --mode <queue|steer>")}`,
    `  ${renderCliCommand("routes clear-additional-message-mode --channel <slack|telegram> <route-id> [--bot <id>]")}`,
    "",
    "Notes:",
    "  - For DM auth, mutate `dm:*`, not `dm:<userId>`.",
    "  - Exact DM routes are behavior-only overrides such as agent, streaming, responseMode, followUp, verbose, or timezone.",
    "  - `set-policy`, `add/remove-allow-user`, and `add/remove-block-user` reject exact DM routes.",
    "  - `pairing approve <channel> <code>` writes the approved sender into the requesting bot's `dm:*` allowUsers.",
    "",
    "Examples:",
    `  ${renderCliCommand("routes add-allow-user --channel slack dm:* --bot support --user U123ABC456")}`,
    `  ${renderCliCommand("routes add-block-user --channel telegram dm:* --bot alerts --user 1276408333")}`,
    `  ${renderCliCommand("routes add-allow-user --channel slack channel:C1234567890 --bot default --user U_OWNER")}`,
    `  ${renderCliCommand("routes add-block-user --channel telegram group:-1001234567890 --bot default --user 1276408333")}`,
  ].join("\n");
}

async function listRoutes(args: string[]) {
  const { config } = await readEditableConfig(getEditableConfigPath());
  const provider = parseOptionalProvider(args);
  const botIdFilter = parseOptionValue(args, "--bot");
  const printJson = hasFlag(args, "--json");
  const rows: Array<Record<string, unknown>> = [];

  if (provider === undefined || provider === "slack") {
    for (const [botId, bot] of Object.entries(getSlackBots(config))) {
      if (botIdFilter && botId !== botIdFilter) {
        continue;
      }
      for (const [routeId, route] of Object.entries(bot.groups ?? {})) {
        rows.push({ channel: "slack", botId, routeId, kind: routeId.split(":", 1)[0], route });
      }
      for (const [routeId, route] of Object.entries(bot.directMessages ?? {})) {
        rows.push({ channel: "slack", botId, routeId, kind: "dm", route });
      }
    }
  }

  if (provider === undefined || provider === "telegram") {
    for (const [botId, bot] of Object.entries(getTelegramBots(config))) {
      if (botIdFilter && botId !== botIdFilter) {
        continue;
      }
      for (const [chatId, group] of Object.entries(bot.groups ?? {})) {
        rows.push({ channel: "telegram", botId, routeId: `group:${chatId}`, kind: "group", route: group });
        for (const [topicId, topic] of Object.entries(group.topics ?? {})) {
          rows.push({
            channel: "telegram",
            botId,
            routeId: `topic:${chatId}:${topicId}`,
            kind: "topic",
            route: topic,
          });
        }
      }
      for (const [routeId, route] of Object.entries(bot.directMessages ?? {})) {
        rows.push({ channel: "telegram", botId, routeId, kind: "dm", route });
      }
    }
  }

  if (printJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log("No routes configured.");
    return;
  }

  console.log("Configured routes:");
  for (const row of rows) {
    const route = row.route as BotRouteConfig;
    console.log(
      `- ${row.channel}/${row.botId}/${row.routeId} enabled=${route.enabled !== false} agent=${route.agentId ?? "(inherit)"} policy=${route.policy ?? "(default)"}`,
    );
  }
}

async function addRoute(args: string[]) {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const parsed = parseCommandRoute(args, provider);
  const policy = parseOptionValue(args, "--policy");
  const requireMention = parseOptionValue(args, "--require-mention");
  const allowBots = parseOptionValue(args, "--allow-bots");
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());

  const existing = getOrCreateRoute(config, provider, botId, parsed);
  if (existing) {
    throw new Error(`Route already exists: ${provider}/${botId}/${parsed.routeId}. Use a matching \`set-<key>\` command instead.`);
  }

  const route = getOrCreateRoute(config, provider, botId, parsed, { create: true, policy });
  if (!route) {
    throw new Error(`Failed to create route: ${provider}/${botId}/${parsed.routeId}`);
  }
  if (requireMention !== undefined) {
    route.requireMention = parseBoolean(requireMention);
  }
  if (allowBots !== undefined) {
    route.allowBots = parseBoolean(allowBots);
  }
  await writeEditableConfig(configPath, config);
  console.log(`added ${provider}/${botId}/${parsed.routeId}`);
  console.log(`config: ${configPath}`);
}

async function getRoute(args: string[]) {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const parsed = parseCommandRoute(args, provider);
  const printJson = hasFlag(args, "--json");
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const route = ensureRoute(config, provider, botId, parsed);

  if (printJson) {
    console.log(JSON.stringify(route, null, 2));
    return;
  }
  console.log(JSON.stringify({ channel: provider, botId, routeId: parsed.routeId, configPath, route }, null, 2));
}

async function setRouteEnabled(args: string[], enabled: boolean) {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const parsed = parseCommandRoute(args, provider);
  rejectExactDirectMessageAdmissionChange(parsed, enabled ? "Enabling" : "Disabling");
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const route = ensureRoute(config, provider, botId, parsed);
  route.enabled = enabled;
  await writeEditableConfig(configPath, config);
  console.log(`${enabled ? "enabled" : "disabled"} ${provider}/${botId}/${parsed.routeId}`);
  console.log(`config: ${configPath}`);
}

async function removeRoute(args: string[]) {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const parsed = parseCommandRoute(args, provider);
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  ensureRoute(config, provider, botId, parsed);

  if (provider === "slack") {
    const bot = ensureSlackBot(config, botId);
    if (parsed.storage === "directMessages") {
      delete bot.directMessages[parsed.key];
    } else {
      delete bot.groups[parsed.key];
    }
  } else {
    const bot = ensureTelegramBot(config, botId);
    if (parsed.storage === "directMessages") {
      delete bot.directMessages[parsed.key];
    } else if ("topicId" in parsed && parsed.topicId) {
      delete bot.groups[parsed.key]?.topics?.[parsed.topicId];
    } else {
      delete bot.groups[parsed.key];
    }
  }

  await writeEditableConfig(configPath, config);
  console.log(`removed ${provider}/${botId}/${parsed.routeId}`);
  console.log(`config: ${configPath}`);
}

async function getSetClearRouteField(args: string[], action: string) {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const parsed = parseCommandRoute(args, provider);
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const route = ensureRoute(config, provider, botId, parsed);

  if (action === "get-agent") {
    console.log(`${provider}/${botId}/${parsed.routeId} agent: ${route.agentId ?? "(inherit)"}`);
  } else if (action === "set-agent") {
    const agentId = parseOptionValue(args, "--agent");
    if (!agentId) {
      throw new Error(renderRoutesHelp());
    }
    route.agentId = agentId;
    await writeEditableConfig(configPath, config);
    console.log(`set agent for ${provider}/${botId}/${parsed.routeId} to ${agentId}`);
  } else if (action === "clear-agent") {
    delete route.agentId;
    await writeEditableConfig(configPath, config);
    console.log(`cleared agent for ${provider}/${botId}/${parsed.routeId}`);
  } else if (action === "get-policy") {
    rejectExactDirectMessageAdmissionChange(parsed, "Reading policy");
    console.log(`${provider}/${botId}/${parsed.routeId} policy: ${route.policy ?? "(default)"}`);
  } else if (action === "set-policy") {
    rejectExactDirectMessageAdmissionChange(parsed, "Setting policy");
    const policy = parseOptionValue(args, "--policy");
    if (!policy) {
      throw new Error(renderRoutesHelp());
    }
    route.policy = policy as BotRouteConfig["policy"];
    await writeEditableConfig(configPath, config);
    console.log(`set policy for ${provider}/${botId}/${parsed.routeId} to ${policy}`);
  } else if (action === "get-require-mention") {
    console.log(`${provider}/${botId}/${parsed.routeId} requireMention: ${route.requireMention ?? "(default)"}`);
  } else if (action === "set-require-mention") {
    route.requireMention = parseBoolean(parseOptionValue(args, "--value"));
    await writeEditableConfig(configPath, config);
    console.log(`set requireMention for ${provider}/${botId}/${parsed.routeId} to ${route.requireMention}`);
  } else if (action === "get-allow-bots") {
    console.log(`${provider}/${botId}/${parsed.routeId} allowBots: ${route.allowBots ?? "(default)"}`);
  } else if (action === "set-allow-bots") {
    route.allowBots = parseBoolean(parseOptionValue(args, "--value"));
    await writeEditableConfig(configPath, config);
    console.log(`set allowBots for ${provider}/${botId}/${parsed.routeId} to ${route.allowBots}`);
  } else if (action === "get-follow-up-mode") {
    console.log(`${provider}/${botId}/${parsed.routeId} followUp.mode: ${route.followUp?.mode ?? "(default)"}`);
  } else if (action === "set-follow-up-mode") {
    const mode = parseOptionValue(args, "--mode");
    if (!mode) {
      throw new Error(renderRoutesHelp());
    }
    route.followUp = {
      ...(route.followUp ?? {}),
      mode: mode as NonNullable<BotRouteConfig["followUp"]>["mode"],
    };
    await writeEditableConfig(configPath, config);
    console.log(`set followUp.mode for ${provider}/${botId}/${parsed.routeId} to ${mode}`);
  } else if (action === "get-follow-up-ttl") {
    console.log(`${provider}/${botId}/${parsed.routeId} followUp.participationTtlMin: ${route.followUp?.participationTtlMin ?? "(default)"}`);
  } else if (action === "set-follow-up-ttl") {
    const minutes = Number.parseInt(parseOptionValue(args, "--minutes") ?? "", 10);
    if (!Number.isInteger(minutes) || minutes <= 0) {
      throw new Error("Expected --minutes <positive-int>.");
    }
    route.followUp = {
      ...(route.followUp ?? {}),
      participationTtlMin: minutes,
    };
    await writeEditableConfig(configPath, config);
    console.log(`set followUp.participationTtlMin for ${provider}/${botId}/${parsed.routeId} to ${minutes}`);
  } else if (action === "get-response-mode") {
    console.log(`${provider}/${botId}/${parsed.routeId} responseMode: ${route.responseMode ?? "(default)"}`);
  } else if (action === "set-response-mode") {
    const mode = parseOptionValue(args, "--mode");
    if (mode !== "capture-pane" && mode !== "message-tool") {
      throw new Error(renderRoutesHelp());
    }
    route.responseMode = mode;
    await writeEditableConfig(configPath, config);
    console.log(`set responseMode for ${provider}/${botId}/${parsed.routeId} to ${mode}`);
  } else if (action === "clear-response-mode") {
    delete route.responseMode;
    await writeEditableConfig(configPath, config);
    console.log(`cleared responseMode for ${provider}/${botId}/${parsed.routeId}`);
  } else if (action === "get-additional-message-mode") {
    console.log(`${provider}/${botId}/${parsed.routeId} additionalMessageMode: ${route.additionalMessageMode ?? "(default)"}`);
  } else if (action === "set-additional-message-mode") {
    const mode = parseOptionValue(args, "--mode");
    if (mode !== "queue" && mode !== "steer") {
      throw new Error(renderRoutesHelp());
    }
    route.additionalMessageMode = mode;
    await writeEditableConfig(configPath, config);
    console.log(`set additionalMessageMode for ${provider}/${botId}/${parsed.routeId} to ${mode}`);
  } else if (action === "clear-additional-message-mode") {
    delete route.additionalMessageMode;
    await writeEditableConfig(configPath, config);
    console.log(`cleared additionalMessageMode for ${provider}/${botId}/${parsed.routeId}`);
  }

  console.log(`config: ${configPath}`);
}

async function mutateRouteUsers(args: string[], action: string) {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const parsed = parseCommandRoute(args, provider);
  rejectExactDirectMessageAdmissionChange(
    parsed,
    action.startsWith("add-") ? "Adding allow/block users" : "Removing allow/block users",
  );
  const user = parseOptionValue(args, "--user");
  if (!user) {
    throw new Error(renderRoutesHelp());
  }
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const route = parsed.storage === "directMessages" && isDirectMessageWildcardRouteId(parsed.routeId)
    ? ensureBotDirectMessageWildcardRoute(config, provider, botId)
    : ensureRoute(config, provider, botId, parsed);
  const field = action.includes("allow") ? "allowUsers" : "blockUsers";
  const current = Array.from(new Set((route[field] ?? []).filter(Boolean)));

  if (action.startsWith("add-")) {
    if (!current.includes(user)) {
      current.push(user);
    }
  } else {
    const index = current.indexOf(user);
    if (index >= 0) {
      current.splice(index, 1);
    }
  }

  route[field] = current;
  await writeEditableConfig(configPath, config);
  console.log(`${action} ${user} for ${provider}/${botId}/${parsed.routeId}`);
  console.log(`config: ${configPath}`);
}

export async function runRoutesCli(args: string[]) {
  const action = args[0];
  const rest = args.slice(1);

  if (!action || action === "--help" || action === "-h" || action === "help") {
    console.log(renderRoutesHelp());
    return;
  }

  if (action === "list") {
    await listRoutes(rest);
    return;
  }
  if (action === "add") {
    await addRoute(rest);
    return;
  }
  if (action === "get") {
    await getRoute(rest);
    return;
  }
  if (action === "enable") {
    await setRouteEnabled(rest, true);
    return;
  }
  if (action === "disable") {
    await setRouteEnabled(rest, false);
    return;
  }
  if (action === "remove") {
    await removeRoute(rest);
    return;
  }

  if (
    action === "get-agent" ||
    action === "set-agent" ||
    action === "clear-agent" ||
    action === "get-policy" ||
    action === "set-policy" ||
    action === "get-require-mention" ||
    action === "set-require-mention" ||
    action === "get-allow-bots" ||
    action === "set-allow-bots" ||
    action === "get-follow-up-mode" ||
    action === "set-follow-up-mode" ||
    action === "get-follow-up-ttl" ||
    action === "set-follow-up-ttl" ||
    action === "get-response-mode" ||
    action === "set-response-mode" ||
    action === "clear-response-mode" ||
    action === "get-additional-message-mode" ||
    action === "set-additional-message-mode" ||
    action === "clear-additional-message-mode"
  ) {
    await getSetClearRouteField(rest, action);
    return;
  }

  if (
    action === "add-allow-user" ||
    action === "remove-allow-user" ||
    action === "add-block-user" ||
    action === "remove-block-user"
  ) {
    await mutateRouteUsers(rest, action);
    return;
  }

  throw new Error(renderRoutesHelp());
}
