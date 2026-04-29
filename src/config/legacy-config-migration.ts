import {
  SUPPORTED_AGENT_CLI_TOOLS,
  SUPPORTED_BOOTSTRAP_MODES,
  inferAgentCliToolId,
} from "./agent-tool-presets.ts";
import { DIRECT_MESSAGE_WILDCARD_ROUTE_ID } from "./direct-message-routes.ts";

type Provider = "slack" | "telegram";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneRecord(value: unknown) {
  return isRecord(value) ? { ...value } : {};
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function copyDefinedFields(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  fields: string[],
) {
  for (const field of fields) {
    if (target[field] === undefined && source[field] !== undefined) {
      target[field] = source[field];
    }
  }
}

function mergeAudienceEntries(...sources: Array<unknown>) {
  return [...new Set(
    sources.flatMap((source) =>
      Array.isArray(source)
        ? source.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean)
        : [],
    ),
  )];
}

function mergeRoute(
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
) {
  if (!base) {
    return override ? { ...override } : undefined;
  }
  if (!override) {
    return { ...base };
  }
  return {
    ...base,
    ...override,
    allowUsers: mergeAudienceEntries(base.allowUsers, override.allowUsers),
    blockUsers: mergeAudienceEntries(base.blockUsers, override.blockUsers),
  };
}

function normalizeLegacyAllowUsers(route: Record<string, unknown>) {
  const nextRoute = { ...route };
  if (nextRoute.allowUsers === undefined && Array.isArray(nextRoute.allowFrom)) {
    nextRoute.allowUsers = nextRoute.allowFrom;
  }
  delete nextRoute.allowFrom;
  return nextRoute;
}

function copyLegacyRouteMap(
  target: Record<string, unknown>,
  source: unknown,
) {
  for (const [routeId, route] of Object.entries(cloneRecord(source))) {
    if (!isRecord(route)) {
      continue;
    }
    const normalizedRoute = normalizeLegacyAllowUsers(route);
    if (normalizedRoute.policy === undefined && normalizedRoute.enabled !== false) {
      normalizedRoute.policy = "open";
    }
    target[routeId] = mergeRoute(cloneRecord(target[routeId]), normalizedRoute);
  }
}

function migrateLegacyDirectMessages(
  bot: Record<string, unknown>,
  legacyDirectMessages: unknown,
) {
  const directMessages = cloneRecord(bot.directMessages);
  const legacy = cloneRecord(legacyDirectMessages);
  if (legacy.enabled !== undefined || legacy.policy !== undefined || legacy.allowFrom !== undefined) {
    directMessages[DIRECT_MESSAGE_WILDCARD_ROUTE_ID] = mergeRoute(
      cloneRecord(directMessages[DIRECT_MESSAGE_WILDCARD_ROUTE_ID]),
      normalizeLegacyAllowUsers(legacy),
    );
  } else {
    copyLegacyRouteMap(directMessages, legacy);
  }
  bot.directMessages = directMessages;
}

function migrateLegacyProviderAccounts(
  providerConfig: Record<string, unknown>,
  legacyChannel: Record<string, unknown>,
  defaultBotId: string,
) {
  const accounts = cloneRecord(legacyChannel.accounts);
  for (const [accountId, rawAccount] of Object.entries(accounts)) {
    if (!isRecord(rawAccount)) {
      continue;
    }
    providerConfig[accountId] = {
      ...cloneRecord(providerConfig[accountId]),
      ...rawAccount,
      name: readString(cloneRecord(providerConfig[accountId]).name) ?? accountId,
    };
  }
  if (!isRecord(providerConfig[defaultBotId])) {
    providerConfig[defaultBotId] = { name: defaultBotId };
  }
}

function migrateLegacyProviderDefaults(params: {
  provider: Provider;
  defaults: Record<string, unknown>;
  legacyChannel: Record<string, unknown>;
}) {
  copyDefinedFields(params.defaults, params.legacyChannel, [
    "enabled",
    "mode",
    "allowBots",
    "dmPolicy",
    "groupPolicy",
    "agentPrompt",
    "commandPrefixes",
    "streaming",
    "response",
    "responseMode",
    "additionalMessageMode",
    "surfaceNotifications",
    "verbose",
    "followUp",
    "timezone",
  ]);
  copyDefinedFields(
    params.defaults,
    params.legacyChannel,
    params.provider === "slack"
      ? ["channelPolicy", "ackReaction", "typingReaction", "replyToMode", "processingStatus"]
      : ["polling"],
  );
}

function migrateLegacyProviderBot(params: {
  provider: Provider;
  bot: Record<string, unknown>;
  legacyChannel: Record<string, unknown>;
}) {
  migrateLegacyProviderDefaults({
    provider: params.provider,
    defaults: params.bot,
    legacyChannel: params.legacyChannel,
  });
  copyDefinedFields(
    params.bot,
    params.legacyChannel,
    params.provider === "slack"
      ? ["appToken", "botToken", "channelPolicy", "ackReaction", "typingReaction", "replyToMode", "processingStatus"]
      : ["botToken", "polling"],
  );
  if (params.bot.agentId === undefined && params.legacyChannel.defaultAgentId !== undefined) {
    params.bot.agentId = params.legacyChannel.defaultAgentId;
  }
  migrateLegacyDirectMessages(params.bot, params.legacyChannel.directMessages);
}

function migrateLegacyProviderChannel(params: {
  provider: Provider;
  providerConfig: Record<string, unknown>;
  legacyChannel: Record<string, unknown>;
}) {
  const defaults = cloneRecord(params.providerConfig.defaults);
  const defaultBotId = readString(params.legacyChannel.defaultBotId) ??
    readString(params.legacyChannel.defaultAccount) ??
    readString(defaults.defaultBotId) ??
    "default";

  defaults.defaultBotId = defaultBotId;
  migrateLegacyProviderDefaults({
    provider: params.provider,
    defaults,
    legacyChannel: params.legacyChannel,
  });

  params.providerConfig.defaults = defaults;
  migrateLegacyProviderAccounts(params.providerConfig, params.legacyChannel, defaultBotId);
  const defaultBot = cloneRecord(params.providerConfig[defaultBotId]);
  migrateLegacyProviderBot({
    provider: params.provider,
    bot: defaultBot,
    legacyChannel: params.legacyChannel,
  });

  const groups = cloneRecord(defaultBot.groups);
  if (params.provider === "slack") {
    copyLegacyRouteMap(groups, params.legacyChannel.channels);
  }
  copyLegacyRouteMap(groups, params.legacyChannel.groups);
  defaultBot.groups = groups;
  params.providerConfig[defaultBotId] = defaultBot;
}

function migrateLegacyChannels(config: Record<string, unknown>) {
  const channels = cloneRecord(config.channels);
  if (!channels.slack && !channels.telegram) {
    return;
  }

  const bots = cloneRecord(config.bots);
  const slack = cloneRecord(bots.slack);
  const telegram = cloneRecord(bots.telegram);
  if (isRecord(channels.slack)) {
    migrateLegacyProviderChannel({
      provider: "slack",
      providerConfig: slack,
      legacyChannel: channels.slack,
    });
  }
  if (isRecord(channels.telegram)) {
    migrateLegacyProviderChannel({
      provider: "telegram",
      providerConfig: telegram,
      legacyChannel: channels.telegram,
    });
  }
  bots.slack = slack;
  bots.telegram = telegram;
  config.bots = bots;
  delete config.channels;
}

function readAgentCli(value: unknown) {
  const cli = readString(value);
  return cli && (SUPPORTED_AGENT_CLI_TOOLS as readonly string[]).includes(cli)
    ? cli
    : undefined;
}

function readBootstrapMode(value: unknown) {
  const mode = readString(value);
  return mode && (SUPPORTED_BOOTSTRAP_MODES as readonly string[]).includes(mode)
    ? mode
    : undefined;
}

function migrateLegacyAgentEntries(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map((entry) => {
    if (!isRecord(entry)) {
      return entry;
    }
    const nextEntry = { ...entry };
    const cli = readAgentCli(nextEntry.cli) ?? readAgentCli(nextEntry.cliTool);
    if (cli) {
      nextEntry.cli = cli;
    }
    delete nextEntry.cliTool;

    const bootstrap = cloneRecord(nextEntry.bootstrap);
    const botType = readBootstrapMode(bootstrap.botType) ?? readBootstrapMode(bootstrap.mode);
    if (botType) {
      bootstrap.botType = botType;
      delete bootstrap.mode;
      nextEntry.bootstrap = bootstrap;
    }
    return nextEntry;
  });
}

function migrateLegacyRunnerShape(
  defaults: Record<string, unknown>,
  runner: Record<string, unknown>,
  runnerDefaults: Record<string, unknown>,
) {
  copyDefinedFields(runnerDefaults, runner, [
    "trustWorkspace",
    "startupDelayMs",
    "startupRetryCount",
    "startupRetryDelayMs",
    "promptSubmitDelayMs",
  ]);

  const command = readString(runner.command);
  const family = inferAgentCliToolId(command) ?? readAgentCli(defaults.cli);
  if (family) {
    const familyConfig = cloneRecord(runner[family]);
    copyDefinedFields(familyConfig, runner, [
      "command",
      "args",
      "startupDelayMs",
      "startupRetryCount",
      "startupRetryDelayMs",
      "startupReadyPattern",
      "startupBlockers",
      "promptSubmitDelayMs",
      "sessionId",
    ]);
    runner[family] = familyConfig;
    defaults.cli = readAgentCli(defaults.cli) ?? family;
  }

  runner.defaults = runnerDefaults;
  for (const field of [
    "command",
    "args",
    "trustWorkspace",
    "startupDelayMs",
    "startupRetryCount",
    "startupRetryDelayMs",
    "startupReadyPattern",
    "startupBlockers",
    "promptSubmitDelayMs",
    "sessionId",
  ]) {
    delete runner[field];
  }
}

function migrateLegacyRootRuntimeSections(config: Record<string, unknown>) {
  const app = cloneRecord(config.app);
  if (isRecord(config.session) && !isRecord(app.session)) {
    app.session = cloneRecord(config.session);
  }
  if (isRecord(config.control) && !isRecord(app.control)) {
    app.control = cloneRecord(config.control);
  }
  config.app = app;

  const agents = cloneRecord(config.agents);
  const defaults = cloneRecord(agents.defaults);
  const runner = cloneRecord(defaults.runner);
  const runnerDefaults = cloneRecord(runner.defaults);
  if (isRecord(config.tmux)) {
    runnerDefaults.tmux = {
      ...cloneRecord(runnerDefaults.tmux),
      ...cloneRecord(config.tmux),
    };
  }
  if (isRecord(defaults.stream) && !isRecord(runnerDefaults.stream)) {
    runnerDefaults.stream = cloneRecord(defaults.stream);
  }
  if (isRecord(defaults.session) && !isRecord(runnerDefaults.session)) {
    runnerDefaults.session = cloneRecord(defaults.session);
  }
  migrateLegacyRunnerShape(defaults, runner, runnerDefaults);
  defaults.runner = runner;
  agents.defaults = defaults;
  agents.list = migrateLegacyAgentEntries(agents.list);
  config.agents = agents;

  delete config.session;
  delete config.control;
  delete config.tmux;
}

export function migrateLegacyConfigShape(config: Record<string, unknown>) {
  migrateLegacyRootRuntimeSections(config);
  migrateLegacyChannels(config);
  return config;
}
