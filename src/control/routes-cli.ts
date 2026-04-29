import { readEditableConfig, writeEditableConfig } from "../config/config-file.ts";
import {
  formatTimezoneLocalTime,
  parseTimezone,
  resolveConfigTimezone,
} from "../config/timezone.ts";
import type {
  BotRouteConfig,
  ClisbotConfig,
  TelegramBotConfig,
} from "../config/schema.ts";
import {
  createDirectMessageBehaviorOverride,
  ensureBotDirectMessageWildcardRoute,
  normalizeDirectMessageRouteId,
} from "../config/direct-message-routes.ts";
import {
  getSharedGroupsWildcardRouteId,
  isSharedGroupsWildcardRouteId,
  normalizeSharedGroupRouteId,
} from "../config/group-routes.ts";
import {
  renderSlackRouteIdSyntax,
  renderTelegramRouteIdSyntax,
} from "../config/route-contract.ts";
import { renderRoutesHelp } from "./routes-cli-help.ts";

type Provider = "slack" | "telegram";
type RouteNode =
  | BotRouteConfig
  | TelegramBotConfig["groups"][string]
  | TelegramBotConfig["groups"][string]["topics"][string];

type ParsedRouteId =
  | {
      provider: "slack";
      routeId: string;
      storage: "groups";
      key: string;
      kind: "group";
    }
  | {
      provider: "telegram";
      routeId: string;
      storage: "groups";
      key: string;
      kind: "group" | "topic";
      topicId?: string;
    }
  | {
      provider: "slack" | "telegram";
      routeId: string;
      storage: "directMessages";
      key: string;
      kind: "dm";
    };

function getEditableConfigPath() {
  return process.env.CLISBOT_CONFIG_PATH;
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
  "--timezone",
]);

function findRouteArgument(args: string[]) {
  return findPositionalArgs(args)[0];
}

function findPositionalArgs(args: string[]) {
  const positional: string[] = [];
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
    positional.push(arg);
  }
  return positional;
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

function validateRoutePolicy(parsed: ParsedRouteId, policy: string | undefined) {
  if (!policy) {
    return undefined;
  }
  const allowedPolicies = parsed.storage === "directMessages"
    ? ["disabled", "pairing", "allowlist", "open"]
    : ["disabled", "allowlist", "open"];
  if (allowedPolicies.includes(policy)) {
    return policy;
  }
  throw new Error(
    `${parsed.routeId} policy must be one of: ${allowedPolicies.join(", ")}`,
  );
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

function ensureSlackBot(config: ClisbotConfig, botId: string) {
  const bot = config.bots.slack[botId];
  if (!bot) {
    throw new Error(`Unknown Slack bot: ${botId}`);
  }
  return bot;
}

function ensureTelegramBot(config: ClisbotConfig, botId: string) {
  const bot = config.bots.telegram[botId];
  if (!bot) {
    throw new Error(`Unknown Telegram bot: ${botId}`);
  }
  return bot;
}

function parseRouteId(provider: Provider, raw: string | undefined): ParsedRouteId {
  const routeId = raw?.trim();
  if (!routeId) {
    throw new Error(renderRoutesHelp());
  }

  if (routeId === "*" || routeId === "group:*" || isSharedGroupsWildcardRouteId(routeId)) {
    return {
      provider,
      routeId: "group:*",
      storage: "groups",
      key: getSharedGroupsWildcardRouteId(),
      kind: "group",
    };
  }

  const [kind, first, second] = routeId.split(":", 3);
  if (kind === "dm" && first?.trim()) {
    return {
      provider,
      routeId: first.trim() === "*" ? "dm:*" : `dm:${first.trim()}`,
      storage: "directMessages",
      key: normalizeDirectMessageRouteId(first.trim()),
      kind: "dm",
    };
  }
  if (kind === "topic" && provider === "telegram" && first?.trim() && second?.trim()) {
    return {
      provider,
      routeId: `topic:${first.trim()}:${second.trim()}`,
      storage: "groups",
      key: first.trim(),
      topicId: second.trim(),
      kind: "topic",
    };
  }
  if (
    (kind === "group" || (provider === "slack" && kind === "channel")) &&
    first?.trim()
  ) {
    return {
      provider,
      routeId: `group:${first.trim()}`,
      storage: "groups",
      key: normalizeSharedGroupRouteId(provider, `${kind}:${first.trim()}`),
      kind: "group",
    };
  }

  if (provider === "slack") {
    throw new Error(`Slack route ids must use ${renderSlackRouteIdSyntax()}.`);
  }
  throw new Error(`Telegram route ids must use ${renderTelegramRouteIdSyntax()}.`);
}

function parseCommandRoute(args: string[], provider: Provider) {
  return parseRouteId(provider, findRouteArgument(args));
}

function isSharedWildcardRoute(parsed: ParsedRouteId) {
  return parsed.storage === "groups" && parsed.key === getSharedGroupsWildcardRouteId();
}

function rejectSharedWildcardRemoval(parsed: ParsedRouteId) {
  if (!isSharedWildcardRoute(parsed)) {
    return;
  }

  throw new Error(
    "Default shared route group:* always exists. Update or disable it instead of removing it.",
  );
}

function createBaseRoute(kind: ParsedRouteId["kind"], policy?: string): BotRouteConfig {
  const route: BotRouteConfig = {
    enabled: kind !== "group" ? true : policy !== "disabled",
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

function createDirectMessageRoute(
  config: ClisbotConfig,
  provider: Provider,
  botId: string,
  policy?: string,
) {
  const wildcardRoute = ensureBotDirectMessageWildcardRoute(config, provider, botId);
  const route = createDirectMessageBehaviorOverride(wildcardRoute);
  if (policy) {
    route.policy = policy as BotRouteConfig["policy"];
  }
  return route;
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
        const createdRoute = createDirectMessageRoute(
          config,
          provider,
          botId,
          options.policy,
        );
        bot.directMessages[parsed.key] = createdRoute;
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
      const createdRoute = createDirectMessageRoute(
        config,
        provider,
        botId,
        options.policy,
      );
      bot.directMessages[parsed.key] = createdRoute;
    }
    return bot.directMessages[parsed.key];
  }

  if (!bot.groups[parsed.key] && options.create) {
    bot.groups[parsed.key] = {
      ...createBaseRoute("group", parsed.kind === "topic" ? undefined : options.policy),
      topics: {},
    };
  }
  const group = bot.groups[parsed.key];
  if (!group) {
    return undefined;
  }
  if (parsed.kind !== "topic" || !parsed.topicId) {
    return group;
  }
  if (!group.topics[parsed.topicId] && options.create) {
    group.topics[parsed.topicId] = createBaseRoute("topic", options.policy);
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

function renderRouteId(params: {
  provider: Provider;
  storage: "groups" | "directMessages";
  key: string;
  topicId?: string;
}) {
  if (params.storage === "directMessages") {
    return params.key === "*" ? "dm:*" : `dm:${params.key}`;
  }
  if (params.key === "*") {
    return "group:*";
  }
  if (params.provider === "telegram" && params.topicId) {
    return `topic:${params.key}:${params.topicId}`;
  }
  return `group:${params.key}`;
}

async function listRoutes(args: string[]) {
  const { config } = await readEditableConfig(getEditableConfigPath());
  const provider = parseOptionalProvider(args);
  const botIdFilter = parseOptionValue(args, "--bot");
  const printJson = hasFlag(args, "--json");
  const rows: Array<Record<string, unknown>> = [];

  if (provider === undefined || provider === "slack") {
    for (const [botId, bot] of Object.entries(config.bots.slack)) {
      if (botId === "defaults" || (botIdFilter && botId !== botIdFilter)) {
        continue;
      }
      for (const [key, route] of Object.entries(bot.groups ?? {})) {
        rows.push({
          channel: "slack",
          botId,
          routeId: renderRouteId({
            provider: "slack",
            storage: "groups",
            key,
          }),
          kind: key === "*" ? "shared" : "group",
          route,
        });
      }
      for (const [key, route] of Object.entries(bot.directMessages ?? {})) {
        rows.push({
          channel: "slack",
          botId,
          routeId: renderRouteId({
            provider: "slack",
            storage: "directMessages",
            key,
          }),
          kind: "dm",
          route,
        });
      }
    }
  }

  if (provider === undefined || provider === "telegram") {
    for (const [botId, bot] of Object.entries(config.bots.telegram)) {
      if (botId === "defaults" || (botIdFilter && botId !== botIdFilter)) {
        continue;
      }
      for (const [key, group] of Object.entries(bot.groups ?? {})) {
        rows.push({
          channel: "telegram",
          botId,
          routeId: renderRouteId({
            provider: "telegram",
            storage: "groups",
            key,
          }),
          kind: key === "*" ? "shared" : "group",
          route: group,
        });
        for (const [topicId, topic] of Object.entries(group.topics ?? {})) {
          rows.push({
            channel: "telegram",
            botId,
            routeId: renderRouteId({
              provider: "telegram",
              storage: "groups",
              key,
              topicId,
            }),
            kind: "topic",
            route: topic,
          });
        }
      }
      for (const [key, route] of Object.entries(bot.directMessages ?? {})) {
        rows.push({
          channel: "telegram",
          botId,
          routeId: renderRouteId({
            provider: "telegram",
            storage: "directMessages",
            key,
          }),
          kind: "dm",
          route,
        });
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
  const policy = validateRoutePolicy(parsed, parseOptionValue(args, "--policy"));
  const requireMention = parseOptionValue(args, "--require-mention");
  const allowBots = parseOptionValue(args, "--allow-bots");
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());

  const existing = getOrCreateRoute(config, provider, botId, parsed);
  if (existing) {
    throw new Error(
      `Route already exists: ${provider}/${botId}/${parsed.routeId}. Use a matching \`set-<key>\` command instead.`,
    );
  }

  const route = getOrCreateRoute(config, provider, botId, parsed, {
    create: true,
    policy,
  });
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
  console.log(
    JSON.stringify({ channel: provider, botId, routeId: parsed.routeId, configPath, route }, null, 2),
  );
}

async function setRouteEnabled(args: string[], enabled: boolean) {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const parsed = parseCommandRoute(args, provider);
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
  rejectSharedWildcardRemoval(parsed);
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
    } else if (parsed.kind === "topic" && parsed.topicId) {
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
    console.log(`${provider}/${botId}/${parsed.routeId} policy: ${route.policy ?? "(default)"}`);
  } else if (action === "set-policy") {
    const policy = validateRoutePolicy(parsed, parseOptionValue(args, "--policy"));
    if (!policy) {
      throw new Error(renderRoutesHelp());
    }
    route.policy = policy as BotRouteConfig["policy"];
    await writeEditableConfig(configPath, config);
    console.log(`set policy for ${provider}/${botId}/${parsed.routeId} to ${policy}`);
  } else if (action === "clear-policy") {
    delete route.policy;
    await writeEditableConfig(configPath, config);
    console.log(`cleared policy for ${provider}/${botId}/${parsed.routeId}`);
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
  } else if (action === "get-timezone") {
    const bot = provider === "slack" ? ensureSlackBot(config, botId) : ensureTelegramBot(config, botId);
    const agentId = route.agentId ?? bot.agentId ?? config.agents.defaults.defaultAgentId;
    const resolved = resolveConfigTimezone({
      config,
      agentId,
      routeTimezone: route.timezone,
      botTimezone: bot.timezone,
    });
    console.log(`${provider}/${botId}/${parsed.routeId} timezone: ${route.timezone ?? "(inherit)"}`);
    console.log(`effective: ${resolved.timezone} (${resolved.source})`);
    console.log(`localTime: ${formatTimezoneLocalTime(resolved.timezone)}`);
  } else if (action === "set-timezone") {
    route.timezone = parseTimezone(parseOptionValue(args, "--timezone") ?? findPositionalArgs(args)[1]);
    await writeEditableConfig(configPath, config);
    console.log(`set timezone for ${provider}/${botId}/${parsed.routeId} to ${route.timezone}`);
  } else if (action === "clear-timezone") {
    delete route.timezone;
    await writeEditableConfig(configPath, config);
    console.log(`cleared timezone for ${provider}/${botId}/${parsed.routeId}`);
  }

  console.log(`config: ${configPath}`);
}

async function mutateRouteUsers(args: string[], action: string) {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const parsed = parseCommandRoute(args, provider);
  const user = parseOptionValue(args, "--user");
  if (!user) {
    throw new Error(renderRoutesHelp());
  }
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const route =
    parsed.storage === "directMessages" && parsed.key === "*"
      ? ensureBotDirectMessageWildcardRoute(config, provider, botId)
      : isSharedWildcardRoute(parsed)
        ? getOrCreateRoute(config, provider, botId, parsed, { create: true })
        : ensureRoute(config, provider, botId, parsed);
  if (!route) {
    throw new Error(`Unknown route: ${provider}/${botId}/${parsed.routeId}`);
  }
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
    action === "clear-policy" ||
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
    action === "clear-additional-message-mode" ||
    action === "get-timezone" ||
    action === "set-timezone" ||
    action === "clear-timezone"
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
