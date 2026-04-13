import { fileURLToPath } from "node:url";
import { parseCliArgs, renderCliHelp } from "./cli.ts";
import { runPairingCli } from "./channels/pairing/cli.ts";
import { addAgentToEditableConfig, runAgentsCli } from "./control/agents-cli.ts";
import { runAccountsCli } from "./control/accounts-cli.ts";
import { runChannelsCli } from "./control/channels-cli.ts";
import { parseBootstrapFlags, type ParsedBootstrapFlags } from "./control/channel-bootstrap-flags.ts";
import { runLoopsCli } from "./control/loops-cli.ts";
import { runMessageCli } from "./control/message-cli.ts";
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
  renderRuntimeDiagnosticsSummary,
  renderStartSummary,
  renderStatusSummary,
} from "./control/runtime-summary.ts";
import {
  renderConfiguredChannelTokenStatusLines,
  renderConfiguredChannelTokenIssueLines,
  renderMissingTokenWarningLines,
  renderChannelSetupHelpLines,
  renderOperatorHelpLines,
} from "./control/startup-bootstrap.ts";
import {
  DEFAULT_CONFIG_PATH,
  DEFAULT_RUNTIME_PID_PATH,
  expandHomePath,
  getDefaultRuntimeCredentialsPath,
} from "./shared/paths.ts";
import { readEditableConfig, writeEditableConfig } from "./config/config-file.ts";
import { shouldBootstrapFirstRunConfig } from "./control/startup-bootstrap.ts";
import {
  MissingEnvVarError,
} from "./config/env-substitution.ts";
import {
  renderOperatorErrorWithHelpLines,
  renderRuntimeErrorLines,
} from "./control/operator-errors.ts";
import { commandExists } from "./shared/process.ts";
import { getClisbotVersion } from "./version.ts";
import {
  applyBootstrapAccountsToConfig,
  buildBootstrapRuntimeMemEnv,
  deactivateExpiredMemAccounts,
  persistBootstrapMemCredentials,
} from "./config/channel-account-management.ts";
import { removeRuntimeCredentials } from "./config/channel-credentials.ts";

type PreparedBootstrapState = {
  bootstrapFlags: ParsedBootstrapFlags;
  config: Awaited<ReturnType<typeof readEditableConfig>>["config"];
  configPath: string;
  configResult: Awaited<ReturnType<typeof ensureConfigFile>>;
  firstRun: boolean;
  lifecycleLines: string[];
  persistenceLines: string[];
};

function printCommandOutcomeBanner(outcome: "success" | "failure") {
  console.log("");
  console.log("+---------+");
  console.log(outcome === "success" ? "| SUCCESS |" : "| FAILED  |");
  console.log("+---------+");
  console.log("");
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
  console.log(`  clisbot ${commandName} --cli codex --bot-type personal`);
  console.log(`  clisbot ${commandName} --cli codex --bot-type team`);
  console.log(`  clisbot ${commandName} --cli claude --bot-type personal`);
  console.log(`  clisbot ${commandName} --cli claude --bot-type team`);
  console.log("Manual setup is still available with `clisbot agents add ...`.");
  for (const line of renderOperatorHelpLines()) {
    console.log(line);
  }
}

function hasLiteralMemCredentials(flags: ParsedBootstrapFlags) {
  return flags.literalWarnings.length > 0;
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
    if (commandName === "start") {
      printCommandOutcomeBanner("failure");
    }
    for (const line of renderMissingTokenWarningLines()) {
      console.log(line);
    }
    return null;
  }

  if (commandName === "init" && hasLiteralMemCredentials(bootstrapFlags) && !bootstrapFlags.persist) {
    throw new Error("`clisbot init` with literal channel tokens requires --persist.");
  }

  const configResult = await ensureConfigFile(configPath);
  const editable = await readEditableConfig(configResult.configPath);
  const config = editable.config;
  const shouldApplyBootstrap = firstRun || bootstrapFlags.sawCredentialFlags;
  let lifecycleLines: string[] = [];
  let persistenceLines: string[] = [];

  if (shouldApplyBootstrap) {
    if (!firstRun && !bootstrapFlags.sawCredentialFlags) {
      // no-op
    } else {
      applyBootstrapAccountsToConfig(
        config,
        {
          slackAccounts: bootstrapFlags.slackAccounts,
          telegramAccounts: bootstrapFlags.telegramAccounts,
        },
        { firstRun },
      );

      if (commandName === "start" && !options.runtimeRunning) {
        lifecycleLines = deactivateExpiredMemAccounts(
          config,
          {
            slack: new Set(
              bootstrapFlags.slackAccounts
                .filter((account) => account.appToken?.kind === "mem" && account.botToken?.kind === "mem")
                .map((account) => account.accountId),
            ),
            telegram: new Set(
              bootstrapFlags.telegramAccounts
                .filter((account) => account.botToken?.kind === "mem")
                .map((account) => account.accountId),
            ),
          },
        );
      }

      if (bootstrapFlags.persist) {
        persistenceLines = persistBootstrapMemCredentials(
          config,
          {
            slackAccounts: bootstrapFlags.slackAccounts,
            telegramAccounts: bootstrapFlags.telegramAccounts,
          },
          runtimeCredentialsPath,
        );
      }

      await writeEditableConfig(configResult.configPath, config);
    }
  }

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

async function initConfig(args: string[] = []) {
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

async function serveForeground() {
  const configPath = expandHomePath(
    process.env.CLISBOT_CONFIG_PATH || DEFAULT_CONFIG_PATH,
  );
  const pidPath = expandHomePath(
    process.env.CLISBOT_PID_PATH || DEFAULT_RUNTIME_PID_PATH,
  );
  const runtimeCredentialsPath = getDefaultRuntimeCredentialsPath();
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
      removeRuntimeCredentials(runtimeCredentialsPath);
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
    removeRuntimeCredentials(runtimeCredentialsPath);
    removeRuntimePid(pidPath);
    throw error;
  }

  process.once("exit", () => {
    removeRuntimeCredentials(runtimeCredentialsPath);
    removeRuntimePid(pidPath);
  });

  await new Promise(() => {});
}

async function start(args: string[] = []) {
  const runtimeStatus = await getRuntimeStatus();
  const bootstrapFlags = parseBootstrapFlags(args);
  if (runtimeStatus.running && hasLiteralMemCredentials(bootstrapFlags) && !bootstrapFlags.persist) {
    throw new Error(
      "Raw channel token input on `clisbot start` requires the runtime to be stopped first, unless you also pass --persist.",
    );
  }

  const state = await prepareBootstrapState(args, "start", {
    runtimeRunning: runtimeStatus.running,
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
      slackAccounts: state.bootstrapFlags.slackAccounts,
      telegramAccounts: state.bootstrapFlags.telegramAccounts,
    },
    process.env,
  );

  for (const line of renderConfiguredChannelTokenStatusLines(state.config, runtimeMemEnv)) {
    console.log(line);
  }
  if (!runtimeStatus.running) {
    const tokenIssueLines = renderConfiguredChannelTokenIssueLines(state.config, runtimeMemEnv);
    for (const line of tokenIssueLines) {
      console.log(line);
    }
    if (tokenIssueLines.length > 0) {
      printCommandOutcomeBanner("failure");
      return;
    }
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
    scriptPath: fileURLToPath(import.meta.url),
    configPath: state.configResult.configPath,
    extraEnv: runtimeStatus.running ? undefined : runtimeMemEnv,
    runtimeCredentialsPath: getDefaultRuntimeCredentialsPath(),
  });

  if (result.alreadyRunning) {
    try {
      const summary = await getRuntimeOperatorSummary({
        configPath: result.configPath,
        runtimeRunning: true,
      });
      printCommandOutcomeBanner("success");
      console.log(`clisbot is already running with pid: ${result.pid}`);
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
      printCommandOutcomeBanner("success");
      console.log(`clisbot is already running with pid: ${result.pid}`);
      console.log("Run `clisbot status` to inspect runtime state or `clisbot logs` to inspect recent activity.");
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
    printCommandOutcomeBanner("success");
    console.log(`clisbot started with pid: ${result.pid}`);
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
    printCommandOutcomeBanner("success");
    console.log(`clisbot started with pid: ${result.pid}`);
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
    printCommandOutcomeBanner("failure");
    console.log("clisbot is not running");
    return;
  }

  if (hard) {
    printCommandOutcomeBanner("success");
    console.log(
      result.stopped
        ? "clisbot stopped and tmux sessions cleaned up"
        : "clisbot was not running, but tmux sessions were cleaned up",
    );
    return;
  }

  printCommandOutcomeBanner("success");
  console.log("clisbot stopped");
}

async function restart() {
  await stopDetachedRuntime({
    hard: false,
  });
  await start();
}

async function status() {
  const runtimeStatus = await getRuntimeStatus();
  console.log(`version: ${getClisbotVersion()}`);
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
    for (const line of renderConfiguredChannelTokenStatusLines(summary.loadedConfig.raw)) {
      console.log(line);
    }
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

  try {
    const runtimeStatus = await getRuntimeStatus();
    const summary = await getRuntimeOperatorSummary({
      configPath: runtimeStatus.configPath,
      runtimeRunning: runtimeStatus.running,
    });
    const diagnostics = renderRuntimeDiagnosticsSummary(summary);
    if (diagnostics) {
      console.log("");
      console.log(diagnostics);
    }
  } catch {
    // Keep raw log access working even when summary rendering fails.
  }
}

async function main(command = parseCliArgs(process.argv)) {

  if (command.name === "help") {
    console.log(renderCliHelp());
    return;
  }

  if (command.name === "version") {
    console.log(getClisbotVersion());
    return;
  }

  if (command.name === "init") {
    await initConfig(command.args);
    return;
  }

  if (command.name === "serve-foreground") {
    await serveForeground();
    return;
  }

  if (command.name === "start") {
    await start(command.args);
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

  if (command.name === "accounts") {
    await runAccountsCli(command.args);
    return;
  }

  if (command.name === "loops") {
    await runLoopsCli(command.args);
    return;
  }

  if (command.name === "message") {
    await runMessageCli(command.args);
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

const command = parseCliArgs(process.argv);

try {
  await main(command);
} catch (error) {
  if (command.name === "start" || command.name === "stop" || command.name === "restart") {
    printCommandOutcomeBanner("failure");
  }
  await printCliError(error);
  process.exit(1);
}
