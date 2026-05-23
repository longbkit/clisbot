import type { ClisbotConfig } from "../../config/core/schema.ts";
import { readEditableConfig, writeEditableConfig } from "../../config/core/config-file.ts";
import {
  getChannelBotRecord,
  reconcileChannelProviderDefaults,
  requireChannelBotRecord,
} from "../../config/channels/channel-bots.ts";
import { renderCliCommand } from "./cli-name.ts";
import {
  confirmZaloPersonalRisk,
  describeConfiguredZaloPersonalBotLogin,
  loginConfiguredZaloPersonalBot,
  logoutConfiguredZaloPersonalBot,
} from "../../channels/zalo-personal/login.ts";
import { buildZaloPersonalBotConfig } from "../../channels/zalo-personal/config.ts";
import {
  ensureAgentExists,
  getBotId,
  getMutuallyExclusiveAgentArgs,
  hasFlag,
  maybeCreateBotAgent,
  parseOptionValue,
  waitForReloadResult,
  type BotsCliDependencies,
} from "./bots-cli-shared.ts";
import type {
  ChannelHealthRecord,
  RuntimeChannelConnection,
} from "../runtime/runtime-health-store.ts";

type HelpRenderer = () => string;
type ZaloPersonalStatusConnection = RuntimeChannelConnection | "not-running" | "unknown";

export function renderZaloPersonalAddHelpLine() {
  return renderCliCommand(
    "bots add --channel zalo-personal [--bot <id>] [--qr-path <path>] [--agent <id>] [--cli <codex|claude|gemini> --bot-type <personal|team>] [--confirm]",
  );
}

export function renderZaloPersonalLifecycleHelpLines() {
  return [
    renderCliCommand("bots login --channel zalo-personal [--bot <id>] [--qr-path <path>] [--confirm]"),
    renderCliCommand("bots logout --channel zalo-personal [--bot <id>]"),
    renderCliCommand("bots status --channel zalo-personal [--bot <id>]"),
  ];
}

function getQrPath(args: string[]) {
  return parseOptionValue(args, "--qr-path");
}

function parseZaloPersonalProvider(args: string[], renderHelp: HelpRenderer) {
  const provider = parseOptionValue(args, "--channel");
  if (provider !== "zalo-personal") {
    throw new Error(renderHelp());
  }
  return provider;
}

function deriveZaloPersonalBotStatusConnection(params: {
  channelEnabled: boolean;
  botEnabled: boolean;
  runtimeRunning: boolean;
  health?: ChannelHealthRecord;
  botId: string;
}): ZaloPersonalStatusConnection {
  if (!params.channelEnabled || !params.botEnabled) {
    return "disabled";
  }
  if (!params.runtimeRunning) {
    return "not-running";
  }
  if (!params.health) {
    return "unknown";
  }
  if (
    params.health.connection === "active" &&
    params.health.instances.length > 0 &&
    !params.health.instances.some((instance) => instance.botId === params.botId)
  ) {
    return "stopped";
  }
  return params.health.connection;
}

async function warnIfZaloPersonalListenerStillRunning(
  botId: string,
  deps: BotsCliDependencies,
) {
  const runtime = await deps.getRuntimeStatus();
  if (!runtime.running) {
    return;
  }
  const health = await deps.runtimeHealthStore.read();
  const active = health.channels["zalo-personal"]?.instances.some(
    (instance) => instance.botId === botId,
  );
  if (active) {
    console.log(
      "warning listener may remain connected until the running clisbot runtime reloads or restarts.",
    );
  }
}

function configureZaloPersonalBot(config: ClisbotConfig, botId: string, agentId?: string) {
  const existing = config.bots.zaloPersonal[botId] as Record<string, unknown> | undefined;
  config.bots.zaloPersonal[botId] = buildZaloPersonalBotConfig({ botId, existing, agentId }) as any;
  config.bots.zaloPersonal.defaults.enabled = true;
  if (
    !config.bots.zaloPersonal.defaults.defaultBotId ||
    config.bots.zaloPersonal.defaults.defaultBotId === "default"
  ) {
    config.bots.zaloPersonal.defaults.defaultBotId = botId;
  }
  reconcileChannelProviderDefaults(config, "zalo-personal");
}

export async function tryAddZaloPersonalBot(
  args: string[],
  deps: BotsCliDependencies,
  renderHelp: HelpRenderer,
) {
  const provider = parseOptionValue(args, "--channel");
  if (provider !== "zalo-personal") {
    return false;
  }
  const botId = getBotId(args);
  let { config, configPath } = await readEditableConfig(process.env.CLISBOT_CONFIG_PATH);
  if (getChannelBotRecord(config, provider, botId)) {
    throw new Error(
      `Bot already exists: ${provider}/${botId}. Use ${renderCliCommand("bots login ...", { inline: true })}, ${renderCliCommand("bots set-agent ...", { inline: true })}, or another \`set-<key>\` command.`,
    );
  }
  const { agentId, cliTool, botType } = getMutuallyExclusiveAgentArgs(args);
  await confirmZaloPersonalRisk(hasFlag(args, "--confirm"));
  const nextAgentId = agentId ?? (cliTool && botType ? await maybeCreateBotAgent(configPath, botId, cliTool, botType) : undefined);
  if (nextAgentId) {
    const refreshed = await readEditableConfig(configPath);
    config = refreshed.config;
    ensureAgentExists(refreshed.config, nextAgentId);
  }
  configureZaloPersonalBot(config, botId, nextAgentId);
  await writeEditableConfig(configPath, config);
  await loginConfiguredZaloPersonalBot({
    config,
    botId,
    qrPath: getQrPath(args),
    skipRiskConfirmation: true,
  });
  const runtimeStatus = await deps.getRuntimeStatus();
  let runtime = "not-running";
  if (runtimeStatus.running) {
    runtime = await waitForReloadResult(configPath, deps) === "success" ? "started" : "failed";
  }
  console.log(`Added zalo-personal/${botId}, persisted=tokenFile, runtime=${runtime}`);
  console.log(`config: ${configPath}`);
  void renderHelp;
  return true;
}

export async function getZaloPersonalCredentialSource(args: string[], renderHelp: HelpRenderer) {
  const provider = parseZaloPersonalProvider(args, renderHelp);
  const botId = getBotId(args);
  const { config, configPath } = await readEditableConfig(process.env.CLISBOT_CONFIG_PATH);
  requireChannelBotRecord(config, provider, botId);
  const source = await describeConfiguredZaloPersonalBotLogin(config, botId);
  console.log(`${provider}/${botId} credentials: source=session-file ${source.detail}`);
  console.log(`config: ${configPath}`);
}

export async function loginZaloPersonalBot(args: string[], renderHelp: HelpRenderer) {
  const provider = parseZaloPersonalProvider(args, renderHelp);
  const botId = getBotId(args);
  const { config, configPath } = await readEditableConfig(process.env.CLISBOT_CONFIG_PATH);
  requireChannelBotRecord(config, provider, botId);
  await loginConfiguredZaloPersonalBot({
    config,
    botId,
    qrPath: getQrPath(args),
    confirmed: hasFlag(args, "--confirm"),
  });
  console.log(`logged in ${provider}/${botId}`);
  console.log(`config: ${configPath}`);
}

export async function logoutZaloPersonalBot(
  args: string[],
  deps: BotsCliDependencies,
  renderHelp: HelpRenderer,
) {
  const provider = parseZaloPersonalProvider(args, renderHelp);
  const botId = getBotId(args);
  const { config, configPath } = await readEditableConfig(process.env.CLISBOT_CONFIG_PATH);
  requireChannelBotRecord(config, provider, botId);
  const tokenFile = await logoutConfiguredZaloPersonalBot(config, botId);
  console.log(`logged out ${provider}/${botId}`);
  console.log(`session: ${tokenFile}`);
  await warnIfZaloPersonalListenerStillRunning(botId, deps);
  console.log(`config: ${configPath}`);
}

export async function statusZaloPersonalBot(
  args: string[],
  deps: BotsCliDependencies,
  renderHelp: HelpRenderer,
) {
  const provider = parseZaloPersonalProvider(args, renderHelp);
  const botId = getBotId(args);
  const { config, configPath } = await readEditableConfig(process.env.CLISBOT_CONFIG_PATH);
  const bot = requireChannelBotRecord(config, provider, botId);
  const login = await describeConfiguredZaloPersonalBotLogin(config, botId);
  const runtime = await deps.getRuntimeStatus();
  const health = await deps.runtimeHealthStore.read();
  const connection = deriveZaloPersonalBotStatusConnection({
    channelEnabled: config.bots.zaloPersonal.defaults.enabled !== false,
    botEnabled: bot.enabled !== false,
    runtimeRunning: runtime.running,
    health: health.channels["zalo-personal"],
    botId,
  });
  console.log(`${provider}/${botId} login=${login.loggedIn ? "present" : "missing"} connection=${connection}`);
  console.log(`credentials: ${login.detail}`);
  console.log(`config: ${configPath}`);
}
