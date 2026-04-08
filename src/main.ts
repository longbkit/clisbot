import { parseCliArgs, renderCliHelp } from "./cli.ts";
import { runPairingCli } from "./channels/pairing/cli.ts";
import { addAgentToEditableConfig, runAgentsCli } from "./control/agents-cli.ts";
import { runChannelsCli } from "./control/channels-cli.ts";
import { RuntimeSupervisor } from "./control/runtime-supervisor.ts";
import {
  ensureConfigFile,
  getRuntimeStatus,
  readRuntimeLog,
  removeRuntimePid,
  StartDetachedRuntimeError,
  startDetachedRuntime,
  stopDetachedRuntime,
  writeRuntimePid,
} from "./control/runtime-process.ts";
import {
  getRuntimeOperatorSummary,
  renderStartSummary,
  renderStatusSummary,
} from "./control/runtime-summary.ts";
import {
  getDefaultChannelAvailability,
  getChannelAvailabilityForBootstrap,
  hasAnyDefaultChannelToken,
  renderBootstrapTokenUsageLines,
  renderConfiguredChannelTokenStatusLines,
  renderConfiguredChannelTokenIssueLines,
  renderDisabledConfiguredChannelWarningLines,
  renderMissingTokenWarningLines,
  renderChannelSetupHelpLines,
  renderOperatorHelpLines,
  type StartCommandOptions,
} from "./control/startup-bootstrap.ts";
import {
  DEFAULT_CONFIG_PATH,
  DEFAULT_RUNTIME_PID_PATH,
  expandHomePath,
} from "./shared/paths.ts";
import { readEditableConfig } from "./config/config-file.ts";
import { shouldBootstrapFirstRunConfig } from "./control/startup-bootstrap.ts";
import {
  MissingEnvVarError,
} from "./config/env-substitution.ts";
import {
  renderOperatorErrorWithHelpLines,
  renderRuntimeErrorLines,
} from "./control/operator-errors.ts";

type PreparedBootstrapState = {
  channelAvailability: ReturnType<typeof getDefaultChannelAvailability>;
  config: Awaited<ReturnType<typeof readEditableConfig>>["config"];
  configPath: string;
  configResult: Awaited<ReturnType<typeof ensureConfigFile>>;
  firstRun: boolean;
};

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
  console.log("");
  console.log(`warning!!! no default agent is configured yet, so muxbot did not ${commandName}.`);
  console.log("First run requires both `--cli` and `--bootstrap`.");
  console.log("");
  console.log("Choose one bootstrap style:");
  console.log("  personal-assistant = one assistant for one human");
  console.log("  team-assistant     = one shared assistant for a team or channel");
  console.log(`Prepare with one of these commands:`);
  console.log(`  muxbot ${commandName} --cli codex --bootstrap personal-assistant`);
  console.log(`  muxbot ${commandName} --cli codex --bootstrap team-assistant`);
  console.log(`  muxbot ${commandName} --cli claude --bootstrap personal-assistant`);
  console.log(`  muxbot ${commandName} --cli claude --bootstrap team-assistant`);
  console.log("Manual setup is still available with `muxbot agents add ...`.");
  for (const line of renderOperatorHelpLines()) {
    console.log(line);
  }
}

async function prepareBootstrapState(
  options: StartCommandOptions,
  requireAvailableDefaultTokens: boolean,
) {
  const configPath = expandHomePath(process.env.MUXBOT_CONFIG_PATH || DEFAULT_CONFIG_PATH);
  const firstRun = shouldBootstrapFirstRunConfig(configPath);
  const channelAvailability = firstRun
    ? getChannelAvailabilityForBootstrap(options)
    : getDefaultChannelAvailability();

  if (requireAvailableDefaultTokens && firstRun && !hasAnyDefaultChannelToken(channelAvailability)) {
    for (const line of renderMissingTokenWarningLines(options)) {
      console.log(line);
    }
    return null;
  }

  const configResult = await ensureConfigFile(configPath, {
    slackEnabled: channelAvailability.slack,
    telegramEnabled: channelAvailability.telegram,
    slackAppTokenRef: options.slackAppTokenRef,
    slackBotTokenRef: options.slackBotTokenRef,
    telegramBotTokenRef: options.telegramBotTokenRef,
  });

  if (firstRun) {
    for (const line of renderBootstrapTokenUsageLines(options)) {
      console.log(line);
    }
  }

  const { config } = await readEditableConfig(configResult.configPath);

  return {
    channelAvailability,
    config,
    configPath,
    configResult,
    firstRun,
  } satisfies PreparedBootstrapState;
}

async function ensureDefaultAgentBootstrap(
  state: PreparedBootstrapState,
  options: StartCommandOptions,
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
    const installed = Bun.spawnSync(["which", options.cliTool], {
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0;
    if (!installed) {
      console.log(`warning ${options.cliTool} is not installed, so muxbot did not start.`);
      console.log(`Install \`${options.cliTool}\`, then run start again.`);
      for (const line of renderOperatorHelpLines()) {
        console.log(line);
      }
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

async function initConfig(options: StartCommandOptions = {}) {
  const state = await prepareBootstrapState(options, false);
  if (!state) {
    return;
  }

  if (state.configResult.created) {
    console.log(`Created ${state.configResult.configPath}`);
  } else {
    console.log(`Config already exists at ${state.configResult.configPath}`);
  }

  const bootstrapped = await ensureDefaultAgentBootstrap(state, options, "init");
  if (state.config.agents.list.length === 0 && !bootstrapped) {
    console.log("No default agent was added. Use `--cli` with `--bootstrap`, or manage agents manually.");
  }
}

async function serveForeground() {
  const configPath = expandHomePath(
    process.env.MUXBOT_CONFIG_PATH || DEFAULT_CONFIG_PATH,
  );
  const pidPath = expandHomePath(
    process.env.MUXBOT_PID_PATH || DEFAULT_RUNTIME_PID_PATH,
  );
  const runtimeSupervisor = new RuntimeSupervisor(configPath);
  let shuttingDown = false;

  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    try {
      await runtimeSupervisor.stop();
    } finally {
      removeRuntimePid(pidPath);
      process.exit(exitCode);
    }
  };

  process.once("SIGINT", () => {
    void shutdown(0);
  });
  process.once("SIGTERM", () => {
    void shutdown(0);
  });

  try {
    await runtimeSupervisor.start();
    await writeRuntimePid(pidPath, process.pid);
  } catch (error) {
    removeRuntimePid(pidPath);
    throw error;
  }

  process.once("exit", () => {
    removeRuntimePid(pidPath);
  });

  await new Promise(() => {});
}

async function start(options: StartCommandOptions = {}) {
  const state = await prepareBootstrapState(options, true);
  if (!state) {
    return;
  }

  for (const line of renderDisabledConfiguredChannelWarningLines(state.config, state.channelAvailability)) {
    console.log(line);
  }
  for (const line of renderConfiguredChannelTokenStatusLines(state.config)) {
    console.log(line);
  }
  const tokenIssueLines = renderConfiguredChannelTokenIssueLines(state.config);
  for (const line of tokenIssueLines) {
    console.log(line);
  }
  if (tokenIssueLines.length > 0) {
    return;
  }

  if (!(await ensureDefaultAgentBootstrap(state, options, "start"))) {
    return;
  }

  const result = await startDetachedRuntime({
    scriptPath: import.meta.path,
    configPath: state.configResult.configPath,
  });

  if (result.alreadyRunning) {
    try {
      const summary = await getRuntimeOperatorSummary({
        configPath: result.configPath,
        runtimeRunning: true,
      });
      console.log(`muxbot is already running with pid: ${result.pid}`);
      const workspacePath = getPrimaryWorkspacePath(summary);
      if (workspacePath) {
        console.log(
          `workspace: ${workspacePath} (agent workspace: default work dir; contains state, sessions, personality, and guidance files)`,
        );
      }
      console.log(`config: ${result.configPath}`);
      console.log(`log: ${result.logPath}`);
      console.log(renderStartSummary(summary));
    } catch (error) {
      console.log(`muxbot is already running with pid: ${result.pid}`);
      console.log("Run `muxbot status` to inspect runtime state or `muxbot logs` to inspect recent activity.");
      for (const line of renderChannelSetupHelpLines()) {
        console.log(line);
      }
      for (const line of renderRuntimeErrorLines("failed to render already-running summary", error)) {
        console.error(line);
      }
    }
    return;
  }

  if (state.configResult.created) {
    console.log(`Created ${result.configPath}`);
  }

  try {
    const summary = await getRuntimeOperatorSummary({
      configPath: result.configPath,
      runtimeRunning: true,
    });
    console.log(`muxbot started with pid: ${result.pid}`);
    const workspacePath = getPrimaryWorkspacePath(summary);
    if (workspacePath) {
      console.log(
        `workspace: ${workspacePath} (agent workspace: default work dir; contains state, sessions, personality, and guidance files)`,
      );
    }
    console.log(`config: ${result.configPath}`);
    console.log(`log: ${result.logPath}`);
    console.log(renderStartSummary(summary));
  } catch (error) {
    console.log(`muxbot started with pid: ${result.pid}`);
    console.log(`config: ${result.configPath}`);
    console.log(`log: ${result.logPath}`);
    for (const line of renderRuntimeErrorLines("failed to render start summary", error)) {
      console.error(line);
    }
  }
}

async function printCliError(error: unknown) {
  if (error instanceof MissingEnvVarError) {
    for (const line of renderOperatorErrorWithHelpLines(error)) {
      console.error(line);
    }
    return;
  }

  for (const line of renderOperatorErrorWithHelpLines(error)) {
    console.error(line);
  }

  const logResult = error instanceof StartDetachedRuntimeError
    ? await readRuntimeLog({
        logPath: error.logPath,
        lines: 40,
        startOffset: error.logStartOffset,
      })
    : await readStartFailureLog(error);

  if (logResult?.text) {
    console.error("");
    console.error("Recent log tail:");
    console.error(logResult.text);
  }
}

async function readStartFailureLog(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const logPathMatch = message.match(/Check (.+)$/);
  if (!logPathMatch) {
    return null;
  }

  return await readRuntimeLog({
    logPath: logPathMatch[1].trim(),
    lines: 40,
  });
}

async function stop(hard = false) {
  const result = await stopDetachedRuntime({
    hard,
  });
  if (!result.stopped && !hard) {
    console.log("muxbot is not running");
    return;
  }

  if (hard) {
    console.log(
      result.stopped
        ? "muxbot stopped and tmux sessions cleaned up"
        : "muxbot was not running, but tmux sessions were cleaned up",
    );
    return;
  }

  console.log("muxbot stopped");
}

async function restart() {
  await stopDetachedRuntime({
    hard: false,
  });
  await start();
}

async function status() {
  const runtimeStatus = await getRuntimeStatus();
  console.log(`running: ${runtimeStatus.running ? "yes" : "no"}`);
  if (runtimeStatus.pid) {
    console.log(`pid: ${runtimeStatus.pid}`);
  }
  try {
    const summary = await getRuntimeOperatorSummary({
      configPath: runtimeStatus.configPath,
      runtimeRunning: runtimeStatus.running,
    });
    const workspacePath = getPrimaryWorkspacePath(summary);
    if (workspacePath) {
      console.log(
        `workspace: ${workspacePath} (agent workspace: default work dir; contains state, sessions, personality, and guidance files)`,
      );
    }
    console.log(`config: ${runtimeStatus.configPath}`);
    console.log(`pid file: ${runtimeStatus.pidPath}`);
    console.log(`log: ${runtimeStatus.logPath}`);
    console.log(`tmux socket: ${runtimeStatus.tmuxSocketPath}`);
    console.log(renderStatusSummary(summary));
  } catch (error) {
    console.log(`config: ${runtimeStatus.configPath}`);
    console.log(`pid file: ${runtimeStatus.pidPath}`);
    console.log(`log: ${runtimeStatus.logPath}`);
    console.log(`tmux socket: ${runtimeStatus.tmuxSocketPath}`);
    for (const line of renderRuntimeErrorLines("failed to render runtime summary", error)) {
      console.error(line);
    }
  }
}

async function logs(lines: number) {
  const result = await readRuntimeLog({
    lines,
  });
  if (!result.text) {
    console.log(`No logs at ${result.logPath}`);
    return;
  }

  console.log(result.text);
}

async function main() {
  const command = parseCliArgs(Bun.argv);

  if (command.name === "help") {
    console.log(renderCliHelp());
    return;
  }

  if (command.name === "init") {
    await initConfig(command);
    return;
  }

  if (command.name === "serve-foreground") {
    await serveForeground();
    return;
  }

  if (command.name === "start") {
    await start(command);
    return;
  }

  if (command.name === "restart") {
    await restart();
    return;
  }

  if (command.name === "stop") {
    await stop(command.hard);
    return;
  }

  if (command.name === "status") {
    await status();
    return;
  }

  if (command.name === "logs") {
    await logs(command.lines);
    return;
  }

  if (command.name === "channels") {
    await runChannelsCli(command.args);
    return;
  }

  if (command.name === "agents") {
    await runAgentsCli(command.args);
    return;
  }

  if (command.name === "pairing") {
    await runPairingCli(command.args);
    return;
  }
}

try {
  await main();
} catch (error) {
  await printCliError(error);
  process.exit(1);
}
