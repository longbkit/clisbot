import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync } from "node:fs";
import { readEditableConfig, writeEditableConfig } from "../../config/core/config-file.ts";
import { parseTimezone } from "../../config/runtime/timezone.ts";
import type { ClisbotConfig } from "../../config/core/schema.ts";
import {
  deleteChannelBotRecord,
  getChannelBotRecord,
  getChannelProviderDefaults,
  listChannelBotSummaries,
  reconcileChannelProviderDefaults,
  requireChannelBotRecord,
} from "../../config/channels/channel-bots.ts";
import { ensureBotDirectMessageWildcardRoute } from "../../config/channels/direct-message-routes.ts";
import {
  describeChannelCredentialSource,
  getConfigReloadMtimeMs,
} from "../../config/channels/channel-credentials.ts";
import {
  applyChannelBotCredentialInput,
  listChannelBotCredentialContracts,
  parseChannelBotCredentialInput,
  renderChannelBotCredentialUsage,
} from "../../config/channels/channel-bot-credentials.ts";
import { RuntimeHealthStore } from "../runtime/runtime-health-store.ts";
import { getRuntimeStatus } from "../runtime/runtime-process.ts";
import { getDefaultRuntimeCredentialsPath } from "../../infra/paths.ts";
import { addAgentToEditableConfig } from "./agents-cli.ts";
import { renderCliCommand } from "./cli-name.ts";
import {
  parseRegisteredChannelOrThrow,
  renderChannelNamePlaceholder,
  renderSupportedChannelsNote,
} from "../../channels/catalog/registry.ts";
import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";

type Provider = ChannelId;

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

function hasHelpFlag(args: string[]) {
  return args.includes("--help") || args.includes("-h");
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
  const channelName = renderChannelNamePlaceholder();
  const addExamples = listChannelBotCredentialContracts().map((contract) =>
    renderCliCommand(
      `bots add --channel ${contract.channel} [--bot <id>] ${renderChannelBotCredentialUsage(contract.channel)} [--agent <id>] [--cli <codex|claude|gemini> --bot-type <personal|team>] [--persist]`,
    )
  );
  const setCredentialExamples = listChannelBotCredentialContracts().map((contract) =>
    renderCliCommand(
      `bots set-credentials --channel ${contract.channel} [--bot <id>] ${renderChannelBotCredentialUsage(contract.channel)} [--persist]`,
    )
  );
  return [
    renderCliCommand("bots"),
    "",
    "Usage:",
    `  ${renderCliCommand("bots --help")}`,
    `  ${renderCliCommand("bots help")}`,
    `  ${renderCliCommand(`bots list [--channel ${channelName}] [--json]`)}`,
    ...addExamples.map((line) => `  ${line}`),
    `  ${renderCliCommand(`bots get --channel ${channelName} [--bot <id>] [--json]`)}`,
    `  ${renderCliCommand(`bots enable --channel ${channelName} [--bot <id>]`)}`,
    `  ${renderCliCommand(`bots disable --channel ${channelName} [--bot <id>]`)}`,
    `  ${renderCliCommand(`bots remove --channel ${channelName} [--bot <id>]`)}`,
    `  ${renderCliCommand(`bots get-default --channel ${channelName}`)}`,
    `  ${renderCliCommand(`bots set-default --channel ${channelName} --bot <id>`)}`,
    `  ${renderCliCommand(`bots get-agent --channel ${channelName} [--bot <id>]`)}`,
    `  ${renderCliCommand(`bots set-agent --channel ${channelName} [--bot <id>] --agent <id>`)}`,
    `  ${renderCliCommand(`bots clear-agent --channel ${channelName} [--bot <id>]`)}`,
    `  ${renderCliCommand(`bots get-timezone --channel ${channelName} [--bot <id>]`)}`,
    `  ${renderCliCommand(`bots set-timezone --channel ${channelName} [--bot <id>] <iana-timezone>`)}`,
    `  ${renderCliCommand(`bots clear-timezone --channel ${channelName} [--bot <id>]`)}`,
    `  ${renderCliCommand(`bots get-credentials-source --channel ${channelName} [--bot <id>]`)}`,
    ...setCredentialExamples.map((line) => `  ${line}`),
    `  ${renderCliCommand(`bots get-dm-policy --channel ${channelName} [--bot <id>]`)}`,
    `  ${renderCliCommand(`bots set-dm-policy --channel ${channelName} [--bot <id>] --policy <disabled|pairing|allowlist|open>`)}`,
    "",
    "Notes:",
    "  - `add` creates only; if the bot already exists, use `set-agent`, `set-credentials`, or another `set-<key>` command",
    "  - `--agent` binds an existing agent as the bot fallback agent",
    "  - `--cli` with `--bot-type` creates a new agent using the same id as the bot",
    "  - if you want an extra agent without adding another provider bot, create it with `agents add ...` and then point this bot at it with `set-agent`",
    "  - prefer app, agent, or route timezone first; bot timezone is an advanced concrete-bot fallback",
    "  - raw token input without `--persist` requires a running clisbot runtime",
    "  - normal shared-route admission now follows the bot's `group:*` default plus any exact `group:<id>` override",
    `  - ${renderSupportedChannelsNote()}`,
  ].join("\n");
}

function parseProvider(args: string[]) {
  try {
    return parseRegisteredChannelOrThrow(parseOptionValue(args, "--channel"));
  } catch {
    throw new Error(renderBotsHelp());
  }
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

async function listBots(args: string[]) {
  const { config } = await readEditableConfig(getEditableConfigPath());
  const provider = parseOptionValue(args, "--channel") as Provider | undefined;
  const printJson = hasFlag(args, "--json");
  const summaries = listChannelBotSummaries(config, provider);

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

  const exists = Boolean(getChannelBotRecord(config, provider, botId));
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

  const parsed = parseChannelBotCredentialInput(args, provider);
  const { persisted } = applyChannelBotCredentialInput({
    config,
    channel: provider,
    botId,
    parsed,
    persist,
    runtimeRunning: runtimeStatus.running,
    agentId: nextAgentId,
  });
  await writeEditableConfig(configPath, config);

  let runtime = "not-running";
  if (runtimeStatus.running) {
    runtime = await waitForReloadResult(configPath, deps) === "success" ? "started" : "failed";
  }

  console.log(`${action === "add" ? "Added" : "Updated"} ${provider}/${botId}, persisted=${persisted}, runtime=${runtime}`);
  console.log(`config: ${configPath}`);
}

async function getBot(args: string[]) {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const printJson = hasFlag(args, "--json");
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const bot = requireChannelBotRecord(config, provider, botId);
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
  const bot = requireChannelBotRecord(config, provider, botId);
  bot.enabled = enabled;
  reconcileChannelProviderDefaults(config, provider);
  await writeEditableConfig(configPath, config);
  console.log(`${enabled ? "enabled" : "disabled"} ${provider}/${botId}`);
  console.log(`config: ${configPath}`);
}

async function removeBot(args: string[]) {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const bot = requireChannelBotRecord(config, provider, botId);

  const directMessages = "directMessages" in bot ? Object.keys(bot.directMessages ?? {}) : [];
  const groups = "groups" in bot ? Object.keys(bot.groups ?? {}) : [];
  if (directMessages.length > 0 || groups.length > 0) {
    throw new Error(`Cannot remove ${provider}/${botId} while routes still exist under that bot.`);
  }

  deleteChannelBotRecord(config, provider, botId);
  reconcileChannelProviderDefaults(config, provider);
  await writeEditableConfig(configPath, config);
  console.log(`removed ${provider}/${botId}`);
  console.log(`config: ${configPath}`);
}

async function getOrSetDefaultBot(args: string[], action: "get-default" | "set-default") {
  const provider = parseProvider(args);
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());

  if (action === "get-default") {
    const botId = getChannelProviderDefaults(config, provider).defaultBotId;
    console.log(`${provider} default bot: ${botId}`);
    console.log(`config: ${configPath}`);
    return;
  }

  const botId = parseOptionValue(args, "--bot");
  if (!botId) {
    throw new Error(renderBotsHelp());
  }
  requireChannelBotRecord(config, provider, botId);
  getChannelProviderDefaults(config, provider).defaultBotId = botId;
  reconcileChannelProviderDefaults(config, provider);
  await writeEditableConfig(configPath, config);
  console.log(`set ${provider} default bot to ${botId}`);
  console.log(`config: ${configPath}`);
}

async function getOrSetBotAgent(args: string[], action: "get-agent" | "set-agent" | "clear-agent") {
  const provider = parseProvider(args);
  const botId = getBotId(args);
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const bot = requireChannelBotRecord(config, provider, botId);

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
  const bot = requireChannelBotRecord(config, provider, botId);

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
  requireChannelBotRecord(config, provider, botId);

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
  requireChannelBotRecord(config, provider, botId);
  const source = describeChannelCredentialSource({
    config,
    channel: provider,
    botId,
  });
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

  if (!action || action === "help" || hasHelpFlag(args)) {
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
