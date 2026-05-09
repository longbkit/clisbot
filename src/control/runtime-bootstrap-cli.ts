import { addAgentToEditableConfig } from "./agents-cli.ts";
import {
  hasLiteralBootstrapCredentials,
  parseBootstrapFlags,
  type ParsedBootstrapFlags,
} from "./channel-bootstrap-flags.ts";
import {
  ensureConfigFile,
  getRuntimeStatus,
  startDetachedRuntime,
  stopDetachedRuntime,
} from "./runtime-process.ts";
import {
  getRuntimeOperatorSummary,
  renderStartSummary,
} from "./runtime-summary.ts";
import {
  renderConfiguredChannelTokenIssueLines,
  renderConfiguredChannelTokenStatusLines,
  renderChannelSetupHelpLines,
  renderMissingTokenWarningLines,
  renderOperatorHelpLines,
} from "./startup-bootstrap.ts";
import { renderRuntimeErrorLines } from "./operator-errors.ts";
import {
  DEFAULT_CONFIG_PATH,
  expandHomePath,
  getDefaultRuntimeCredentialsPath,
} from "../shared/paths.ts";
import { readEditableConfig, writeEditableConfig } from "../config/config-file.ts";
import { shouldBootstrapFirstRunConfig } from "./startup-bootstrap.ts";
import { commandExists } from "../shared/process.ts";
import {
  applyBootstrapBotsToConfig,
  buildBootstrapRuntimeMemEnv,
  deactivateExpiredMemBots,
  persistBootstrapMemBotCredentials,
} from "../config/channel-bot-management.ts";
import {
  printCommandOutcomeBanner,
  printCommandOutcomeFooter,
} from "./runtime-cli-shared.ts";
import { renderCliCommand } from "../shared/cli-name.ts";

type PreparedBootstrapState = {
  bootstrapFlags: ParsedBootstrapFlags;
  config: Awaited<ReturnType<typeof readEditableConfig>>["config"];
  configPath: string;
  configResult: Awaited<ReturnType<typeof ensureConfigFile>>;
  firstRun: boolean;
  lifecycleLines: string[];
  persistenceLines: string[];
};

function hasHelpFlag(args: string[]) {
  return args.includes("--help") || args.includes("-h") || args.includes("help");
}

function renderBootstrapCommandHelp(commandName: "init" | "start") {
  const behavior =
    commandName === "start"
      ? "seed config if needed and start the detached runtime"
      : "seed config and optionally bootstrap the first agent without starting runtime";

  return [
    renderCliCommand(commandName),
    "",
    "Usage:",
    `  ${renderCliCommand(`${commandName} --help`)}`,
    `  ${renderCliCommand(`${commandName} [--cli <codex|claude|gemini>] [--bot-type <personal|team>] [--persist]`)}`,
    "                   [--slack-account <id> --slack-app-token <ENV_NAME|${ENV_NAME}|literal> --slack-bot-token <ENV_NAME|${ENV_NAME}|literal>]...",
    "                   [--telegram-account <id> --telegram-bot-token <ENV_NAME|${ENV_NAME}|literal>]...",
    "                   [--zalo-bot-account <id> --zalo-bot-token <ENV_NAME|${ENV_NAME}|literal>]...",
    "",
    "Behavior:",
    `  - ${behavior}`,
    "  - first-run agent bootstrap needs both `--cli` and `--bot-type`",
    "  - `--bot-type` is a workspace-template choice, not a general runtime requirement for later agents",
    "  - `--bot-type personal` maps to `personal-assistant`; `--bot-type team` maps to `team-assistant`",
    "  - bootstrap seeds `AGENTS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, and the rest of the workspace guidance files",
    "  - Claude and Gemini bootstraps also create `CLAUDE.md` or `GEMINI.md` as symlinks to `AGENTS.md`",
    "  - explicit credential flags only enable the channels and bots you named in this command",
    "  - env-style values such as `SLACK_APP_TOKEN` or `${SLACK_APP_TOKEN}` stay env-backed in config",
    commandName === "start"
      ? "  - literal token values without `--persist` stay runtime-only for this start invocation"
      : "  - literal token values on `init` require `--persist` because no runtime exists yet",
    `  - \`--persist\` writes canonical credential files so later plain ${renderCliCommand("start")} can reuse them`,
    "",
    "Examples:",
    `  ${renderCliCommand(`${commandName} --cli codex --bot-type personal --telegram-bot-token TELEGRAM_BOT_TOKEN`)}`,
    `  ${renderCliCommand(`${commandName} --cli codex --bot-type personal --zalo-bot-token ZALO_BOT_TOKEN`)}`,
    `  ${renderCliCommand(`${commandName} --cli codex --bot-type team --slack-app-token SLACK_APP_TOKEN --slack-bot-token SLACK_BOT_TOKEN`)}`,
    `  ${renderCliCommand(`${commandName} --cli gemini --bot-type personal --telegram-bot-token \"$TELEGRAM_BOT_TOKEN\" --persist`)}`,
    "",
    "Related help:",
    `  - ${renderCliCommand("agents --help", { inline: true })} for lower-level agent bootstrap and binding control`,
    `  - ${renderCliCommand("bots --help", { inline: true })} for bot credentials and fallback agent setup`,
    `  - ${renderCliCommand("routes --help", { inline: true })} for route setup after bootstrap`,
  ].join("\n");
}

function getPrimaryWorkspacePath(
  summary: Awaited<ReturnType<typeof getRuntimeOperatorSummary>>,
) {
  const preferredAgentId =
    summary.channelSummaries.find((channel) => channel.enabled)?.defaultAgentId ??
    "default";

  return (
    summary.agentSummaries.find((agent) => agent.id === preferredAgentId)?.workspacePath ??
    summary.agentSummaries[0]?.workspacePath
  );
}

function printMissingBootstrapOptions(commandName: "init" | "start") {
  if (commandName === "start") {
    printCommandOutcomeBanner("failure");
  }
  console.log("");
  console.log(`warning!!! no default agent is configured yet, so clisbot did not ${commandName}.`);
  console.log("First run requires both `--cli` and `--bot-type`.");
  console.log("");
  console.log("Choose one bot type:");
  console.log("  personal = one assistant for one human");
  console.log("  team     = one shared assistant for a team or channel");
  console.log("Prepare with one of these commands:");
  console.log(`  ${renderCliCommand(`${commandName} --cli codex --bot-type personal`)}`);
  console.log(`  ${renderCliCommand(`${commandName} --cli codex --bot-type team`)}`);
  console.log(`  ${renderCliCommand(`${commandName} --cli claude --bot-type personal`)}`);
  console.log(`  ${renderCliCommand(`${commandName} --cli claude --bot-type team`)}`);
  console.log(`  ${renderCliCommand(`${commandName} --cli gemini --bot-type personal`)}`);
  console.log(`  ${renderCliCommand(`${commandName} --cli gemini --bot-type team`)}`);
  console.log(`Manual setup is still available with ${renderCliCommand("agents add ...", { inline: true })}.`);
  for (const line of renderOperatorHelpLines()) {
    console.log(line);
  }
  if (commandName === "start") {
    printCommandOutcomeFooter("failure");
  }
}

function hasLiteralMemCredentials(flags: ParsedBootstrapFlags) {
  return hasLiteralBootstrapCredentials(flags);
}

function printMissingFirstRunCredentials(commandName: "init" | "start") {
  if (commandName === "start") {
    printCommandOutcomeBanner("failure");
  }
  for (const line of renderMissingTokenWarningLines()) {
    console.log(line);
  }
  if (commandName === "start") {
    printCommandOutcomeFooter("failure");
  }
}

function getMemBootstrapBotIds(bootstrapFlags: ParsedBootstrapFlags) {
  return {
    slack: new Set(
      bootstrapFlags.slackBots
        .filter((bot) => bot.appToken?.kind === "mem" && bot.botToken?.kind === "mem")
        .map((bot) => bot.botId),
    ),
    telegram: new Set(
      bootstrapFlags.telegramBots
        .filter((bot) => bot.botToken?.kind === "mem")
        .map((bot) => bot.botId),
    ),
    "zalo-bot": new Set(
      bootstrapFlags.zaloBotBots
        .filter((bot) => bot.botToken?.kind === "mem")
        .map((bot) => bot.botId),
    ),
  };
}

async function applyBootstrapStateToConfig(params: {
  config: Awaited<ReturnType<typeof readEditableConfig>>["config"];
  configPath: string;
  bootstrapFlags: ParsedBootstrapFlags;
  commandName: "init" | "start";
  firstRun: boolean;
  runtimeRunning: boolean;
  runtimeCredentialsPath: string;
}) {
  const { config, configPath, bootstrapFlags, commandName, firstRun, runtimeRunning, runtimeCredentialsPath } =
    params;
  if (!firstRun && !bootstrapFlags.sawCredentialFlags) {
    return {
      lifecycleLines: [],
      persistenceLines: [],
    };
  }

  applyBootstrapBotsToConfig(
    config,
    {
      slackBots: bootstrapFlags.slackBots,
      telegramBots: bootstrapFlags.telegramBots,
      zaloBotBots: bootstrapFlags.zaloBotBots,
    },
    { firstRun },
  );

  const lifecycleLines =
    commandName === "start" && !runtimeRunning
      ? deactivateExpiredMemBots(config, getMemBootstrapBotIds(bootstrapFlags))
      : [];
  const persistenceLines = bootstrapFlags.persist
    ? persistBootstrapMemBotCredentials(
        config,
        {
          slackBots: bootstrapFlags.slackBots,
          telegramBots: bootstrapFlags.telegramBots,
          zaloBotBots: bootstrapFlags.zaloBotBots,
        },
        runtimeCredentialsPath,
      )
    : [];

  await writeEditableConfig(configPath, config);

  return {
    lifecycleLines,
    persistenceLines,
  };
}

async function prepareBootstrapState(
  rawArgs: string[],
  commandName: "init" | "start",
  options: {
    runtimeRunning: boolean;
    bootstrapFlags?: ParsedBootstrapFlags;
  } = {
    runtimeRunning: false,
  },
) {
  const bootstrapFlags = options.bootstrapFlags ?? parseBootstrapFlags(rawArgs);
  const configPath = expandHomePath(process.env.CLISBOT_CONFIG_PATH || DEFAULT_CONFIG_PATH);
  const firstRun = shouldBootstrapFirstRunConfig(configPath);
  const runtimeCredentialsPath = getDefaultRuntimeCredentialsPath();

  if (firstRun && !bootstrapFlags.sawCredentialFlags) {
    printMissingFirstRunCredentials(commandName);
    return null;
  }

  if (commandName === "init" && hasLiteralMemCredentials(bootstrapFlags) && !bootstrapFlags.persist) {
    throw new Error(
      `${renderCliCommand("init", { inline: true })} with literal channel tokens requires --persist.`,
    );
  }

  const configResult = await ensureConfigFile(configPath);
  const editable = await readEditableConfig(configResult.configPath);
  const config = editable.config;
  const { lifecycleLines, persistenceLines } = await applyBootstrapStateToConfig({
    config,
    configPath: configResult.configPath,
    bootstrapFlags,
    commandName,
    firstRun,
    runtimeRunning: options.runtimeRunning,
    runtimeCredentialsPath,
  });

  return {
    bootstrapFlags,
    config: (await readEditableConfig(configResult.configPath)).config,
    configPath,
    configResult,
    firstRun,
    lifecycleLines,
    persistenceLines,
  } satisfies PreparedBootstrapState;
}

async function ensureDefaultAgentBootstrap(
  state: PreparedBootstrapState,
  options: ParsedBootstrapFlags,
  commandName: "init" | "start",
) {
  if (state.config.agents.list.length > 0) {
    return true;
  }

  if (!options.cliTool || !options.bootstrap) {
    if (commandName === "start") {
      printMissingBootstrapOptions(commandName);
    }
    return false;
  }

  if (commandName === "start") {
    const installed = commandExists(options.cliTool);
    if (!installed) {
      printCommandOutcomeBanner("failure");
      console.log(`warning ${options.cliTool} is not installed, so clisbot did not start.`);
      console.log(`Install \`${options.cliTool}\`, then run start again.`);
      for (const line of renderOperatorHelpLines()) {
        console.log(line);
      }
      printCommandOutcomeFooter("failure");
      return false;
    }
  }

  await addAgentToEditableConfig({
    configPath: state.configResult.configPath,
    agentId: "default",
    cliTool: options.cliTool,
    bootstrap: options.bootstrap,
  });
  console.log(`Bootstrapped default agent with ${options.cliTool}/${options.bootstrap}.`);
  state.config = (await readEditableConfig(state.configResult.configPath)).config;

  return true;
}

function printConfiguredTokenStatus(
  state: PreparedBootstrapState,
  runtimeMemEnv: NodeJS.ProcessEnv,
) {
  for (const line of renderConfiguredChannelTokenStatusLines(state.config, runtimeMemEnv)) {
    console.log(line);
  }
}

function printTokenIssuesIfAny(
  state: PreparedBootstrapState,
  runtimeMemEnv: NodeJS.ProcessEnv,
) {
  const tokenIssueLines = renderConfiguredChannelTokenIssueLines(state.config, runtimeMemEnv);
  for (const line of tokenIssueLines) {
    console.log(line);
  }
  if (tokenIssueLines.length === 0) {
    return false;
  }

  printCommandOutcomeBanner("failure");
  printCommandOutcomeFooter("failure");
  return true;
}

async function printAlreadyRunningStartSummary(pid: number, configPath: string, logPath: string) {
  try {
    const summary = await getRuntimeOperatorSummary({
      configPath,
      runtimeRunning: true,
    });
    printCommandOutcomeBanner("success");
    console.log(`clisbot is already running with pid: ${pid}`);
    const workspacePath = getPrimaryWorkspacePath(summary);
    if (workspacePath) {
      console.log(`workspace: ${workspacePath}`);
    }
    console.log(`config: ${configPath}`);
    console.log(`log: ${logPath}`);
    console.log(renderStartSummary(summary));
    printCommandOutcomeFooter("success");
  } catch (error) {
    printCommandOutcomeBanner("success");
    console.log(`clisbot is already running with pid: ${pid}`);
    console.log(
      `Run ${renderCliCommand("status", { inline: true })} to inspect runtime state or ${renderCliCommand("logs", { inline: true })} to inspect recent activity.`,
    );
    for (const line of renderChannelSetupHelpLines()) {
      console.log(line);
    }
    for (const line of renderRuntimeErrorLines("failed to render already-running summary", error)) {
      console.error(line);
    }
    printCommandOutcomeFooter("success");
  }
}

async function printStartedRuntimeSummary(pid: number, configPath: string, logPath: string) {
  try {
    const summary = await getRuntimeOperatorSummary({
      configPath,
      runtimeRunning: true,
    });
    printCommandOutcomeBanner("success");
    console.log(`clisbot started with pid: ${pid}`);
    const workspacePath = getPrimaryWorkspacePath(summary);
    if (workspacePath) {
      console.log(`workspace: ${workspacePath}`);
    }
    console.log(`config: ${configPath}`);
    console.log(`log: ${logPath}`);
    console.log(renderStartSummary(summary));
    printCommandOutcomeFooter("success");
  } catch (error) {
    printCommandOutcomeBanner("success");
    console.log(`clisbot started with pid: ${pid}`);
    console.log(`config: ${configPath}`);
    console.log(`log: ${logPath}`);
    for (const line of renderRuntimeErrorLines("failed to render start summary", error)) {
      console.error(line);
    }
    printCommandOutcomeFooter("success");
  }
}

export async function initConfig(args: string[] = []) {
  if (hasHelpFlag(args)) {
    console.log(renderBootstrapCommandHelp("init"));
    return;
  }

  const state = await prepareBootstrapState(args, "init");
  if (!state) {
    return;
  }

  if (state.configResult.created) {
    console.log(`Created ${state.configResult.configPath}`);
  } else {
    console.log(`Config already exists at ${state.configResult.configPath}`);
  }

  const bootstrapped = await ensureDefaultAgentBootstrap(state, state.bootstrapFlags, "init");
  if (state.config.agents.list.length === 0 && !bootstrapped) {
    console.log("No default agent was added. Use `--cli` with `--bot-type`, or manage agents manually.");
  }

  for (const line of state.persistenceLines) {
    console.log(line);
  }
}

export async function start(args: string[] = []) {
  if (hasHelpFlag(args)) {
    console.log(renderBootstrapCommandHelp("start"));
    return;
  }

  const runtimeStatus = await getRuntimeStatus();
  const bootstrapFlags = parseBootstrapFlags(args);
  const restartForLiteralBootstrap =
    runtimeStatus.running && hasLiteralMemCredentials(bootstrapFlags);

  if (restartForLiteralBootstrap) {
    await stopDetachedRuntime({
      configPath: runtimeStatus.configPath,
    });
  }

  const state = await prepareBootstrapState(args, "start", {
    runtimeRunning: restartForLiteralBootstrap ? false : runtimeStatus.running,
    bootstrapFlags,
  });
  if (!state) {
    return;
  }

  for (const line of state.lifecycleLines) {
    console.log(line);
  }

  const runtimeMemEnv = buildBootstrapRuntimeMemEnv(
    {
      slackBots: state.bootstrapFlags.slackBots,
      telegramBots: state.bootstrapFlags.telegramBots,
      zaloBotBots: state.bootstrapFlags.zaloBotBots,
    },
    process.env,
  );

  printConfiguredTokenStatus(state, runtimeMemEnv);
  if ((restartForLiteralBootstrap || !runtimeStatus.running) && printTokenIssuesIfAny(state, runtimeMemEnv)) {
    return;
  }

  if (!(await ensureDefaultAgentBootstrap(state, state.bootstrapFlags, "start"))) {
    return;
  }

  for (const line of state.bootstrapFlags.literalWarnings) {
    console.log(`warning ${line}`);
  }
  for (const line of state.persistenceLines) {
    console.log(line);
  }

  const result = await startDetachedRuntime({
    scriptPath: process.argv[1]!,
    configPath: state.configResult.configPath,
    extraEnv: restartForLiteralBootstrap || !runtimeStatus.running ? runtimeMemEnv : undefined,
    runtimeCredentialsPath: getDefaultRuntimeCredentialsPath(),
  });

  if (result.alreadyRunning) {
    await printAlreadyRunningStartSummary(result.pid, result.configPath, result.logPath);
    return;
  }

  if (state.configResult.created) {
    console.log(`Created ${result.configPath}`);
  }

  await printStartedRuntimeSummary(result.pid, result.configPath, result.logPath);
}
