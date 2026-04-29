import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync } from "node:fs";
import { readEditableConfig, writeEditableConfig } from "../config/config-file.ts";
import { parseTimezone } from "../config/timezone.ts";
import type { ClisbotConfig } from "../config/schema.ts";
import { ensureBotDirectMessageWildcardRoute } from "../config/direct-message-routes.ts";
import {
  describeSlackCredentialSource,
  describeTelegramCredentialSource,
  getConfigReloadMtimeMs,
  parseTokenInput,
  persistSlackCredential,
  persistTelegramCredential,
  setSlackRuntimeCredential,
  setTelegramRuntimeCredential,
  clearSlackRuntimeCredential,
  clearTelegramRuntimeCredential,
} from "../config/channel-credentials.ts";
import { RuntimeHealthStore } from "./runtime-health-store.ts";
import { getRuntimeStatus } from "./runtime-process.ts";
import { getDefaultRuntimeCredentialsPath } from "../shared/paths.ts";
import { addAgentToEditableConfig } from "./agents-cli.ts";
import { renderCliCommand } from "../shared/cli-name.ts";

type Provider = "slack" | "telegram";

type BotsCliDependencies = {
  getRuntimeStatus: typeof getRuntimeStatus;
  runtimeHealthStore: RuntimeHealthStore;
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

function parseAliasedOptionValue(args: string[], names: string[], label: string) {
  const values = names.flatMap((name) => {
    const value = parseOptionValue(args, name);
    return value === undefined ? [] : [{ name, value }];
  });

  if (values.length === 0) {
    return undefined;
  }

  const distinctValues = Array.from(new Set(values.map((entry) => entry.value)));
  if (distinctValues.length > 1) {
    const seen = values.map((entry) => `${entry.name}=${entry.value}`).join(", ");
    throw new Error(`Conflicting values for ${label}: ${seen}`);
  }

  return values[values.length - 1]?.value;
}

function readRuntimeCredentialDocument() {
  const path = process.env.CLISBOT_RUNTIME_CREDENTIALS_PATH ?? getDefaultRuntimeCredentialsPath();
  if (!existsSync(path)) {
    return {};
  }
  const text = readFileSync(path, "utf8").trim();
  return text ? JSON.parse(text) : {};
}

async function waitForReloadResult(
  configPath: string,
  deps: BotsCliDependencies,
  timeoutMs = 12_000,
) {
  const expectedMtimeMs = getConfigReloadMtimeMs(configPath);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const document = await deps.runtimeHealthStore.read();
    if (
      document.reload &&
      document.reload.reason === "watch" &&
      (document.reload.configMtimeMs ?? 0) >= expectedMtimeMs
    ) {
      return document.reload.status;
    }
    await sleep(200);
  }

  return "failed" as const;
}

function renderBotsHelp() {
  return [
    renderCliCommand("bots"),
    "",
    "Usage:",
    `  ${renderCliCommand("bots --help")}`,
    `  ${renderCliCommand("bots help")}`,
    `  ${renderCliCommand("bots list [--channel <slack|telegram>] [--json]")}`,
    `  ${renderCliCommand("bots add --channel telegram [--bot <id>] --bot-token <ENV_NAME|${ENV_NAME}|literal> [--agent <id>] [--cli <codex|claude|gemini> --bot-type <personal|team>] [--persist]")}`,
    `  ${renderCliCommand("bots add --channel slack [--bot <id>] --app-token <ENV_NAME|${ENV_NAME}|literal> --bot-token <ENV_NAME|${ENV_NAME}|literal> [--agent <id>] [--cli <codex|claude|gemini> --bot-type <personal|team>] [--persist]")}`,
    `  ${renderCliCommand("bots get --channel <slack|telegram> [--bot <id>] [--json]")}`,
    `  ${renderCliCommand("bots enable --channel <slack|telegram> [--bot <id>]")}`,
    `  ${renderCliCommand("bots disable --channel <slack|telegram> [--bot <id>]")}`,
    `  ${renderCliCommand("bots remove --channel <slack|telegram> [--bot <id>]")}`,
    `  ${renderCliCommand("bots get-default --channel <slack|telegram>")}`,
    `  ${renderCliCommand("bots set-default --channel <slack|telegram> --bot <id>")}`,
    `  ${renderCliCommand("bots get-agent --channel <slack|telegram> [--bot <id>]")}`,
    `  ${renderCliCommand("bots set-agent --channel <slack|telegram> [--bot <id>] --agent <id>")}`,
    `  ${renderCliCommand("bots clear-agent --channel <slack|telegram> [--bot <id>]")}`,
    `  ${renderCliCommand("bots get-timezone --channel <slack|telegram> [--bot <id>]")}`,
    `  ${renderCliCommand("bots set-timezone --channel <slack|telegram> [--bot <id>] <iana-timezone>")}`,
    `  ${renderCliCommand("bots clear-timezone --channel <slack|telegram> [--bot <id>]")}`,
    `  ${renderCliCommand("bots get-credentials-source --channel <slack|telegram> [--bot <id>]")}`,
    `  ${renderCliCommand("bots set-credentials --channel telegram [--bot <id>] --bot-token <ENV_NAME|${ENV_NAME}|literal> [--persist]")}`,
    `  ${renderCliCommand("bots set-credentials --channel slack [--bot <id>] --app-token <ENV_NAME|${ENV_NAME}|literal> --bot-token <ENV_NAME|${ENV_NAME}|literal> [--persist]")}`,
    `  ${renderCliCommand("bots get-dm-policy --channel <slack|telegram> [--bot <id>]")}`,
    `  ${renderCliCommand("bots set-dm-policy --channel <slack|telegram> [--bot <id>] --policy <disabled|pairing|allowlist|open>")}`,
    "",
    "Notes:",
    "  - `add` creates only; if the bot already exists, use `set-agent`, `set-credentials`, or another `set-<key>` command",
    "  - `--agent` binds an existing agent as the bot fallback agent",
    "  - `--cli` with `--bot-type` creates a new agent using the same id as the bot",
    "  - if you want an extra agent without adding another provider bot, create it with `agents add ...` and then point this bot at it with `set-agent`",
    "  - prefer app, agent, or route timezone first; bot timezone is an advanced concrete-bot fallback",
    "  - raw token input without `--persist` requires a running clisbot runtime",
    "  - normal shared-route admission now follows the bot's `group:*` default plus any exact `group:<id>` override",
  ].join("\n");
}

function parseProvider(args: string[]) {
  const channel = parseOptionValue(args, "--channel");
  if (channel === "slack" || channel === "telegram") {
    return channel;
  }
  throw new Error(renderBotsHelp());
}

function getBotId(args: string[]) {
  return parseOptionValue(args, "--bot") ?? "default";
}

function findLastPositionalArg(args: string[]) {
  let value: string | undefined;
  const flagsWithValue = new Set(["--channel", "--bot", "--agent", "--app-token", "--bot-token"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (flagsWithValue.has(arg)) {
      index += 1;
      continue;
    }
    if (arg?.startsWith("--")) {
      continue;
    }
    value = arg;
  }
  return value;
}

function getSlackBots(config: ClisbotConfig) {
  const { defaults, ...bots } = config.bots.slack;
  return bots;
}

function getTelegramBots(config: ClisbotConfig) {
  const { defaults, ...bots } = config.bots.telegram;
  return bots;
}

function listEnabledBotIds(bots: Record<string, { enabled?: boolean }>) {
  return Object.entries(bots)
    .filter(([, bot]) => bot.enabled !== false)
    .map(([botId]) => botId);
}

function reconcileProviderDefaults(config: ClisbotConfig, provider: Provider) {
  if (provider === "slack") {
    const enabledBotIds = listEnabledBotIds(getSlackBots(config));
    config.bots.slack.defaults.enabled = enabledBotIds.length > 0;
    if (enabledBotIds.length === 0) {
      config.bots.slack.defaults.defaultBotId = "default";
      return;
    }
    if (!enabledBotIds.includes(config.bots.slack.defaults.defaultBotId)) {
      config.bots.slack.defaults.defaultBotId = enabledBotIds[0]!;
    }
    return;
  }

  const enabledBotIds = listEnabledBotIds(getTelegramBots(config));
  config.bots.telegram.defaults.enabled = enabledBotIds.length > 0;
  if (enabledBotIds.length === 0) {
    config.bots.telegram.defaults.defaultBotId = "default";
    return;
  }
  if (!enabledBotIds.includes(config.bots.telegram.defaults.defaultBotId)) {
    config.bots.telegram.defaults.defaultBotId = enabledBotIds[0]!;
  }
}

function ensureAgentExists(config: ClisbotConfig, agentId: string) {
  if (!config.agents.list.some((entry) => entry.id === agentId)) {
    throw new Error(`Unknown agent: ${agentId}`);
  }
}

function getMutuallyExclusiveAgentArgs(args: string[]) {
  const agentId = parseOptionValue(args, "--agent");
  const cliTool = parseOptionValue(args, "--cli");
  const botType = parseOptionValue(args, "--bot-type");

  if (agentId && (cliTool || botType)) {
    throw new Error("Use either --agent or --cli with --bot-type, not both.");
  }

  if ((cliTool && !botType) || (!cliTool && botType)) {
    throw new Error("When creating a new bot agent, pass both --cli and --bot-type.");
  }

  return {
    agentId,
    cliTool,
    botType,
  };
}

async function maybeCreateBotAgent(
  configPath: string,
  botId: string,
  cliTool?: string,
  botType?: string,
) {
  if (!cliTool && !botType) {
    return undefined;
  }

  if (cliTool !== "codex" && cliTool !== "claude" && cliTool !== "gemini") {
    throw new Error("Bot agent CLI must be one of: codex, claude, gemini.");
  }
  if (botType !== "personal" && botType !== "team") {
    throw new Error("Bot agent type must be `personal` or `team`.");
  }

  await addAgentToEditableConfig({
    configPath,
    agentId: botId,
    cliTool,
    bootstrap: botType === "personal" ? "personal-assistant" : "team-assistant",
  });

  return botId;
}

function summarizeBotConfig(provider: Provider, botId: string, bot: Record<string, unknown>) {
  if (provider === "slack") {
    return {
      channel: "slack",
      botId,
      enabled: bot.enabled !== false,
      agentId: typeof bot.agentId === "string" ? bot.agentId : undefined,
      credentialType: typeof bot.credentialType === "string" ? bot.credentialType : "env",
      routeCount:
        (typeof bot === "object" && bot && "groups" in bot && bot.groups && typeof bot.groups === "object"
          ? Object.keys(bot.groups as Record<string, unknown>).length
          : 0) +
        (typeof bot === "object" && bot && "directMessages" in bot && bot.directMessages && typeof bot.directMessages === "object"
          ? Object.keys(bot.directMessages as Record<string, unknown>).length
          : 0),
    };
  }

  const groups = typeof bot === "object" && bot && "groups" in bot && bot.groups && typeof bot.groups === "object"
    ? (bot.groups as Record<string, { topics?: Record<string, unknown> }>)
    : {};
  const groupCount = Object.keys(groups).length;
  const topicCount = Object.values(groups).reduce((total, group) => {
    return total + Object.keys(group.topics ?? {}).length;
  }, 0);

  return {
    channel: "telegram",
    botId,
    enabled: bot.enabled !== false,
    agentId: typeof bot.agentId === "string" ? bot.agentId : undefined,
    credentialType: typeof bot.credentialType === "string" ? bot.credentialType : "env",
    routeCount:
      groupCount +
      topicCount +
      (typeof bot === "object" && bot && "directMessages" in bot && bot.directMessages && typeof bot.directMessages === "object"
        ? Object.keys(bot.directMessages as Record<string, unknown>).length
        : 0),
  };
}

async function listBots(args: string[]) {
  const { config } = await readEditableConfig(getEditableConfigPath());
  const provider = parseOptionValue(args, "--channel");
  const printJson = hasFlag(args, "--json");

  const summaries = [
    ...(provider === undefined || provider === "slack"
      ? Object.entries(getSlackBots(config)).map(([botId, bot]) => summarizeBotConfig("slack", botId, bot))
      : []),
    ...(provider === undefined || provider === "telegram"
      ? Object.entries(getTelegramBots(config)).map(([botId, bot]) =>
          summarizeBotConfig("telegram", botId, bot)
        )
      : []),
  ];

  if (printJson) {
    console.log(JSON.stringify(summaries, null, 2));
    return;
  }

  if (summaries.length === 0) {
    console.log("No bots configured.");
    return;
  }

  console.log("Configured bots:");
  for (const summary of summaries) {
    console.log(
      `- ${summary.channel}/${summary.botId} enabled=${summary.enabled} agent=${summary.agentId ?? "(inherit)"} credentials=${summary.credentialType} routes=${summary.routeCount}`,
    );
  }
}

async function addOrSetBotCredentials(
  args: string[],
  deps: BotsCliDependencies,
  action: "add" | "set-credentials",
) {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const persist = hasFlag(args, "--persist");
  const runtimeStatus = await deps.getRuntimeStatus();
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());

  const exists = provider === "slack" ? botId in getSlackBots(config) : botId in getTelegramBots(config);
  if (action === "add" && exists) {
    throw new Error(
      `Bot already exists: ${provider}/${botId}. Use ${renderCliCommand("bots set-agent ...", { inline: true })}, ${renderCliCommand("bots set-credentials ...", { inline: true })}, or another \`set-<key>\` command.`,
    );
  }
  if (action === "set-credentials" && !exists) {
    throw new Error(`Unknown bot: ${provider}/${botId}`);
  }

  const { agentId, cliTool, botType } = getMutuallyExclusiveAgentArgs(args);
  const nextAgentId = agentId ?? (cliTool && botType ? await maybeCreateBotAgent(configPath, botId, cliTool, botType) : undefined);
  if (nextAgentId) {
    const refreshed = await readEditableConfig(configPath);
    ensureAgentExists(refreshed.config, nextAgentId);
  }

  if (provider === "telegram") {
    const token = parseTokenInput(
      parseAliasedOptionValue(args, ["--bot-token", "--telegram-bot-token"], "telegram bot token") ?? "",
    );

    if (token.kind === "mem" && !persist && !runtimeStatus.running) {
      throw new Error("Raw telegram bot token input without --persist requires a running clisbot runtime.");
    }

    const existing = config.bots.telegram[botId];
    config.bots.telegram[botId] = token.kind === "env"
      ? {
          ...existing,
          enabled: true,
          ...(nextAgentId ? { agentId: nextAgentId } : {}),
          credentialType: undefined,
          botToken: token.placeholder,
          tokenFile: undefined,
        }
      : {
          ...existing,
          enabled: true,
          ...(nextAgentId ? { agentId: nextAgentId } : {}),
          credentialType: persist ? "tokenFile" : "mem",
          botToken: "",
          tokenFile: undefined,
        };

    let persisted = token.kind === "env" ? "env" : "mem";
    if (token.kind === "mem") {
      setTelegramRuntimeCredential({ botId, botToken: token.secret });
    }
    if (persist && token.kind === "mem") {
      persistTelegramCredential({ botId, botToken: token.secret });
      clearTelegramRuntimeCredential({ botId });
      persisted = "tokenFile";
    }

    if (!config.bots.telegram.defaults.defaultBotId || config.bots.telegram.defaults.defaultBotId === "default") {
      config.bots.telegram.defaults.defaultBotId = botId;
    }
    reconcileProviderDefaults(config, "telegram");
    await writeEditableConfig(configPath, config);

    let runtime = "not-running";
    if (runtimeStatus.running) {
      runtime = await waitForReloadResult(configPath, deps) === "success" ? "started" : "failed";
    }

    console.log(`${action === "add" ? "Added" : "Updated"} telegram/${botId}, persisted=${persisted}, runtime=${runtime}`);
    console.log(`config: ${configPath}`);
    return;
  }

  const appToken = parseTokenInput(
    parseAliasedOptionValue(args, ["--app-token", "--slack-app-token"], "slack app token") ?? "",
  );
  const botToken = parseTokenInput(
    parseAliasedOptionValue(args, ["--bot-token", "--slack-bot-token"], "slack bot token") ?? "",
  );

  if (appToken.kind !== botToken.kind) {
    throw new Error("Slack app token and bot token must use the same input kind.");
  }
  if (appToken.kind === "mem" && !persist && !runtimeStatus.running) {
    throw new Error("Raw slack token input without --persist requires a running clisbot runtime.");
  }

  const existing = config.bots.slack[botId];
  config.bots.slack[botId] = appToken.kind === "env"
    ? {
        ...existing,
        enabled: true,
        ...(nextAgentId ? { agentId: nextAgentId } : {}),
        credentialType: undefined,
        appToken: appToken.placeholder,
        botToken: botToken.kind === "env" ? botToken.placeholder : "",
        appTokenFile: undefined,
        botTokenFile: undefined,
      }
    : {
        ...existing,
        enabled: true,
        ...(nextAgentId ? { agentId: nextAgentId } : {}),
        credentialType: persist ? "tokenFile" : "mem",
        appToken: "",
        botToken: "",
        appTokenFile: undefined,
        botTokenFile: undefined,
      };

  let persisted = appToken.kind === "env" ? "env" : "mem";
  if (appToken.kind === "mem" && botToken.kind === "mem") {
    setSlackRuntimeCredential({
      botId,
      appToken: appToken.secret,
      botToken: botToken.secret,
    });
  }
  if (persist && appToken.kind === "mem" && botToken.kind === "mem") {
    persistSlackCredential({
      botId,
      appToken: appToken.secret,
      botToken: botToken.secret,
    });
    clearSlackRuntimeCredential({ botId });
    persisted = "tokenFile";
  }

  if (!config.bots.slack.defaults.defaultBotId || config.bots.slack.defaults.defaultBotId === "default") {
    config.bots.slack.defaults.defaultBotId = botId;
  }
  reconcileProviderDefaults(config, "slack");
  await writeEditableConfig(configPath, config);

  let runtime = "not-running";
  if (runtimeStatus.running) {
    runtime = await waitForReloadResult(configPath, deps) === "success" ? "started" : "failed";
  }

  console.log(`${action === "add" ? "Added" : "Updated"} slack/${botId}, persisted=${persisted}, runtime=${runtime}`);
  console.log(`config: ${configPath}`);
}

function getProviderBot(config: ClisbotConfig, provider: Provider, botId: string) {
  return provider === "slack" ? config.bots.slack[botId] : config.bots.telegram[botId];
}

function ensureProviderBot(config: ClisbotConfig, provider: Provider, botId: string) {
  const bot = getProviderBot(config, provider, botId);
  if (!bot) {
    throw new Error(`Unknown bot: ${provider}/${botId}`);
  }
  return bot;
}

async function getBot(args: string[]) {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const printJson = hasFlag(args, "--json");
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const bot = ensureProviderBot(config, provider, botId);
  if (printJson) {
    console.log(JSON.stringify(bot, null, 2));
    return;
  }
  console.log(JSON.stringify({ channel: provider, botId, configPath, bot }, null, 2));
}

async function setBotEnabled(args: string[], enabled: boolean) {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const bot = ensureProviderBot(config, provider, botId);
  bot.enabled = enabled;
  reconcileProviderDefaults(config, provider);
  await writeEditableConfig(configPath, config);
  console.log(`${enabled ? "enabled" : "disabled"} ${provider}/${botId}`);
  console.log(`config: ${configPath}`);
}

async function removeBot(args: string[]) {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const bot = ensureProviderBot(config, provider, botId);

  const directMessages = "directMessages" in bot ? Object.keys(bot.directMessages ?? {}) : [];
  const groups = "groups" in bot ? Object.keys(bot.groups ?? {}) : [];
  if (directMessages.length > 0 || groups.length > 0) {
    throw new Error(`Cannot remove ${provider}/${botId} while routes still exist under that bot.`);
  }

  if (provider === "slack") {
    delete config.bots.slack[botId];
  } else {
    delete config.bots.telegram[botId];
  }
  reconcileProviderDefaults(config, provider);
  await writeEditableConfig(configPath, config);
  console.log(`removed ${provider}/${botId}`);
  console.log(`config: ${configPath}`);
}

async function getOrSetDefaultBot(args: string[], action: "get-default" | "set-default") {
  const provider = parseProvider(args);
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());

  if (action === "get-default") {
    const botId = provider === "slack"
      ? config.bots.slack.defaults.defaultBotId
      : config.bots.telegram.defaults.defaultBotId;
    console.log(`${provider} default bot: ${botId}`);
    console.log(`config: ${configPath}`);
    return;
  }

  const botId = parseOptionValue(args, "--bot");
  if (!botId) {
    throw new Error(renderBotsHelp());
  }
  ensureProviderBot(config, provider, botId);
  if (provider === "slack") {
    config.bots.slack.defaults.defaultBotId = botId;
  } else {
    config.bots.telegram.defaults.defaultBotId = botId;
  }
  reconcileProviderDefaults(config, provider);
  await writeEditableConfig(configPath, config);
  console.log(`set ${provider} default bot to ${botId}`);
  console.log(`config: ${configPath}`);
}

async function getOrSetBotAgent(args: string[], action: "get-agent" | "set-agent" | "clear-agent") {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const bot = ensureProviderBot(config, provider, botId);

  if (action === "get-agent") {
    console.log(`${provider}/${botId} agent: ${bot.agentId ?? "(inherit)"}`);
    console.log(`config: ${configPath}`);
    return;
  }

  if (action === "clear-agent") {
    delete bot.agentId;
    await writeEditableConfig(configPath, config);
    console.log(`cleared fallback agent for ${provider}/${botId}`);
    console.log(`config: ${configPath}`);
    return;
  }

  const agentId = parseOptionValue(args, "--agent");
  if (!agentId) {
    throw new Error(renderBotsHelp());
  }
  ensureAgentExists(config, agentId);
  bot.agentId = agentId;
  await writeEditableConfig(configPath, config);
  console.log(`set fallback agent for ${provider}/${botId} to ${agentId}`);
  console.log(`config: ${configPath}`);
}

async function getSetClearBotTimezone(
  args: string[],
  action: "get-timezone" | "set-timezone" | "clear-timezone",
) {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const bot = ensureProviderBot(config, provider, botId);

  if (action === "get-timezone") {
    console.log(`${provider}/${botId} timezone: ${bot.timezone ?? "(inherit)"}`);
    console.log(`config: ${configPath}`);
    return;
  }

  if (action === "clear-timezone") {
    delete bot.timezone;
    await writeEditableConfig(configPath, config);
    console.log(`cleared timezone for ${provider}/${botId}`);
    console.log(`config: ${configPath}`);
    return;
  }

  bot.timezone = parseTimezone(parseOptionValue(args, "--timezone") ?? findLastPositionalArg(args));
  await writeEditableConfig(configPath, config);
  console.log(`set timezone for ${provider}/${botId} to ${bot.timezone}`);
  console.log(`config: ${configPath}`);
}

function ensureDefaultDmRoute(config: ClisbotConfig, provider: Provider, botId: string) {
  return ensureBotDirectMessageWildcardRoute(config, provider, botId);
}

async function getOrSetBotPolicy(args: string[], action: string) {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const bot = ensureProviderBot(config, provider, botId);

  if (action === "get-dm-policy") {
    console.log(`${provider}/${botId} dmPolicy: ${ensureDefaultDmRoute(config, provider, botId).policy ?? "pairing"}`);
    console.log(`config: ${configPath}`);
    return;
  }

  if (action === "set-dm-policy") {
    const policy = parseOptionValue(args, "--policy");
    if (policy !== "disabled" && policy !== "pairing" && policy !== "allowlist" && policy !== "open") {
      throw new Error(renderBotsHelp());
    }
    ensureDefaultDmRoute(config, provider, botId).policy = policy;
    await writeEditableConfig(configPath, config);
    console.log(`set dmPolicy for ${provider}/${botId} to ${policy}`);
    console.log(`config: ${configPath}`);
    return;
  }

  throw new Error(renderBotsHelp());
}

async function getCredentialSource(args: string[]) {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  ensureProviderBot(config, provider, botId);
  const source = provider === "slack"
    ? describeSlackCredentialSource({ config: config.bots.slack, botId })
    : describeTelegramCredentialSource({ config: config.bots.telegram, botId });
  console.log(`${provider}/${botId} credentials: ${source.detail}`);
  console.log(`config: ${configPath}`);
}

export async function runBotsCli(
  args: string[],
  deps: Partial<BotsCliDependencies> = {},
) {
  const resolvedDeps: BotsCliDependencies = {
    getRuntimeStatus,
    runtimeHealthStore: new RuntimeHealthStore(),
    ...deps,
  };
  const action = args[0];

  if (!action || action === "--help" || action === "-h" || action === "help") {
    console.log(renderBotsHelp());
    return;
  }

  if (action === "list") {
    await listBots(args.slice(1));
    return;
  }

  if (action === "add") {
    await addOrSetBotCredentials(args.slice(1), resolvedDeps, "add");
    return;
  }

  if (action === "set-credentials") {
    await addOrSetBotCredentials(args.slice(1), resolvedDeps, "set-credentials");
    return;
  }

  if (action === "get") {
    await getBot(args.slice(1));
    return;
  }

  if (action === "enable") {
    await setBotEnabled(args.slice(1), true);
    return;
  }

  if (action === "disable") {
    await setBotEnabled(args.slice(1), false);
    return;
  }

  if (action === "remove") {
    await removeBot(args.slice(1));
    return;
  }

  if (action === "get-default" || action === "set-default") {
    await getOrSetDefaultBot(args.slice(1), action);
    return;
  }

  if (action === "get-agent" || action === "set-agent" || action === "clear-agent") {
    await getOrSetBotAgent(args.slice(1), action);
    return;
  }

  if (action === "get-timezone" || action === "set-timezone" || action === "clear-timezone") {
    await getSetClearBotTimezone(args.slice(1), action);
    return;
  }

  if (
    action === "get-dm-policy" ||
    action === "set-dm-policy"
  ) {
    await getOrSetBotPolicy(args.slice(1), action);
    return;
  }

  if (action === "get-credentials-source") {
    await getCredentialSource(args.slice(1));
    return;
  }

  throw new Error(renderBotsHelp());
}
