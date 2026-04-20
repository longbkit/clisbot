import { RuntimeSupervisor } from "./runtime-supervisor.ts";
import {
  getRuntimeStatus,
  readRuntimeLog,
  removeRuntimePid,
  StartDetachedRuntimeError,
  stopDetachedRuntime,
  writeRuntimePid,
} from "./runtime-process.ts";
import { serveMonitor } from "./runtime-monitor.ts";
import {
  getRuntimeOperatorSummary,
  renderRuntimeDiagnosticsSummary,
  renderStatusSummary,
} from "./runtime-summary.ts";
import {
  renderConfiguredChannelTokenStatusLines,
} from "./startup-bootstrap.ts";
import {
  DEFAULT_CONFIG_PATH,
  DEFAULT_RUNTIME_PID_PATH,
  expandHomePath,
  getDefaultRuntimeCredentialsPath,
} from "../shared/paths.ts";
import { installRuntimeConsoleTimestamps } from "../shared/logging.ts";
import { MissingEnvVarError } from "../config/env-substitution.ts";
import {
  renderOperatorErrorWithHelpLines,
  renderRuntimeErrorLines,
} from "./operator-errors.ts";
import { getClisbotVersion } from "../version.ts";
import { removeRuntimeCredentials } from "../config/channel-credentials.ts";
import {
  printCommandOutcomeBanner,
  printCommandOutcomeFooter,
} from "./runtime-cli-shared.ts";

function getOperatorConfigPath() {
  return expandHomePath(process.env.CLISBOT_CONFIG_PATH || DEFAULT_CONFIG_PATH);
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

function createShutdown(
  runtimeSupervisor: RuntimeSupervisor,
  pidPath: string,
  runtimeCredentialsPath: string,
  shutdownConfig: { supervised?: boolean } = {},
) {
  let shuttingDown = false;

  return async (exitCode = 0, options: { markChannelsStopped?: boolean } = {}) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    try {
      await runtimeSupervisor.stop({
        markChannelsStopped: options.markChannelsStopped,
      });
    } finally {
      if (!shutdownConfig.supervised) {
        removeRuntimeCredentials(runtimeCredentialsPath);
        removeRuntimePid(pidPath);
      }
      process.exit(exitCode);
    }
  };
}

function registerProcessHandlers(
  runtimeSupervisor: RuntimeSupervisor,
  shutdown: (exitCode?: number, options?: { markChannelsStopped?: boolean }) => Promise<void>,
) {
  let fatalHandling = false;

  const handleFatal = async (source: "uncaughtException" | "unhandledRejection", error: unknown) => {
    if (fatalHandling) {
      return;
    }

    fatalHandling = true;
    const detail = error instanceof Error ? error.message : String(error);
    const fatalError = new Error(`fatal ${source}: ${detail}`);
    console.error(`clisbot fatal ${source}`, error);
    const forceExitTimer = setTimeout(() => {
      process.exit(1);
    }, 5_000);
    forceExitTimer.unref?.();

    try {
      await runtimeSupervisor.markFatalFailure(fatalError);
    } catch (markError) {
      console.error("failed to record fatal runtime health", markError);
    }

    try {
      await shutdown(1, { markChannelsStopped: false });
    } finally {
      clearTimeout(forceExitTimer);
    }
  };

  process.once("SIGINT", () => {
    void shutdown(0);
  });
  process.once("SIGTERM", () => {
    void shutdown(0);
  });
  process.once("uncaughtException", (error) => {
    void handleFatal("uncaughtException", error);
  });
  process.once("unhandledRejection", (error) => {
    void handleFatal("unhandledRejection", error);
  });
}

async function printStatusSummary() {
  const runtimeStatus = await getRuntimeStatus({
    configPath: getOperatorConfigPath(),
  });
  console.log(`version: ${getClisbotVersion()}`);
  console.log(`running: ${runtimeStatus.running ? "yes" : "no"}`);
  if (runtimeStatus.pid) {
    console.log(`pid: ${runtimeStatus.pid}`);
  }
  console.log(`service mode: ${runtimeStatus.serviceMode}`);
  if (runtimeStatus.serviceState) {
    console.log(`service state: ${runtimeStatus.serviceState}`);
  }
  if (runtimeStatus.runtimePid) {
    console.log(`runtime pid: ${runtimeStatus.runtimePid}`);
  }
  if (runtimeStatus.restartNumber) {
    console.log(`restart attempt: ${runtimeStatus.restartNumber}`);
  }
  if (runtimeStatus.restartMode) {
    console.log(`restart mode: ${runtimeStatus.restartMode}`);
  }
  if (runtimeStatus.restartStageIndex != null && runtimeStatus.restartStageIndex >= 0) {
    console.log(`restart stage: ${runtimeStatus.restartStageIndex + 1}`);
  }
  if (runtimeStatus.nextRestartAt) {
    console.log(`next restart: ${runtimeStatus.nextRestartAt}`);
  }
  if (runtimeStatus.stopReason) {
    console.log(`last stop reason: ${runtimeStatus.stopReason}`);
  }
  try {
    const summary = await getRuntimeOperatorSummary({
      configPath: runtimeStatus.configPath,
      runtimeRunning: runtimeStatus.running,
    });
    const workspacePath = getPrimaryWorkspacePath(summary);
    if (workspacePath) {
      console.log(`workspace: ${workspacePath}`);
    }
    console.log(`config: ${runtimeStatus.configPath}`);
    console.log(`pid file: ${runtimeStatus.pidPath}`);
    console.log(`monitor state: ${runtimeStatus.monitorStatePath}`);
    console.log(`log: ${runtimeStatus.logPath}`);
    console.log(`tmux socket: ${runtimeStatus.tmuxSocketPath}`);
    for (const line of renderConfiguredChannelTokenStatusLines(summary.loadedConfig.raw)) {
      console.log(line);
    }
    console.log(renderStatusSummary(summary));
  } catch (error) {
    console.log(`config: ${runtimeStatus.configPath}`);
    console.log(`pid file: ${runtimeStatus.pidPath}`);
    console.log(`monitor state: ${runtimeStatus.monitorStatePath}`);
    console.log(`log: ${runtimeStatus.logPath}`);
    console.log(`tmux socket: ${runtimeStatus.tmuxSocketPath}`);
    for (const line of renderRuntimeErrorLines("failed to render runtime summary", error)) {
      console.error(line);
    }
  }
}

async function printDiagnosticsAfterLogTail() {
  try {
    const runtimeStatus = await getRuntimeStatus({
      configPath: getOperatorConfigPath(),
    });
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

export async function serveForeground() {
  installRuntimeConsoleTimestamps();
  const configPath = expandHomePath(
    process.env.CLISBOT_CONFIG_PATH || DEFAULT_CONFIG_PATH,
  );
  const pidPath = expandHomePath(
    process.env.CLISBOT_PID_PATH || DEFAULT_RUNTIME_PID_PATH,
  );
  const runtimeCredentialsPath = getDefaultRuntimeCredentialsPath();
  const supervised = process.env.CLISBOT_RUNTIME_MONITORED === "1";
  const runtimeSupervisor = new RuntimeSupervisor(configPath);
  const shutdown = createShutdown(runtimeSupervisor, pidPath, runtimeCredentialsPath, {
    supervised,
  });

  registerProcessHandlers(runtimeSupervisor, shutdown);

  try {
    await runtimeSupervisor.start();
    if (!supervised) {
      await writeRuntimePid(pidPath, process.pid);
    }
  } catch (error) {
    if (!supervised) {
      removeRuntimeCredentials(runtimeCredentialsPath);
      removeRuntimePid(pidPath);
    }
    throw error;
  }

  if (!supervised) {
    process.once("exit", () => {
      removeRuntimeCredentials(runtimeCredentialsPath);
      removeRuntimePid(pidPath);
    });
  }

  await new Promise(() => {});
}

export async function serveRuntimeMonitor() {
  const configPath = expandHomePath(
    process.env.CLISBOT_CONFIG_PATH || DEFAULT_CONFIG_PATH,
  );
  const pidPath = expandHomePath(
    process.env.CLISBOT_PID_PATH || DEFAULT_RUNTIME_PID_PATH,
  );
  const runtimeCredentialsPath = expandHomePath(
    process.env.CLISBOT_RUNTIME_CREDENTIALS_PATH || getDefaultRuntimeCredentialsPath(),
  );
  await serveMonitor({
    scriptPath: process.argv[1]!,
    configPath,
    pidPath,
    runtimeCredentialsPath,
  });
}

export async function printCliError(error: unknown) {
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

export async function stop(hard = false) {
  const result = await stopDetachedRuntime({
    configPath: getOperatorConfigPath(),
    hard,
  });
  if (!result.stopped && !hard) {
    printCommandOutcomeBanner("failure");
    console.log("clisbot is not running");
    printCommandOutcomeFooter("failure");
    return;
  }

  if (hard) {
    printCommandOutcomeBanner("success");
    console.log(
      result.stopped
        ? "clisbot stopped and tmux sessions cleaned up"
        : "clisbot was not running, but tmux sessions were cleaned up",
    );
    printCommandOutcomeFooter("success");
    return;
  }

  printCommandOutcomeBanner("success");
  console.log("clisbot stopped");
  printCommandOutcomeFooter("success");
}

export async function restart() {
  await stopDetachedRuntime({
    configPath: getOperatorConfigPath(),
    hard: false,
  });
}

export async function status() {
  await printStatusSummary();
}

export async function logs(lines: number) {
  const runtimeStatus = await getRuntimeStatus({
    configPath: getOperatorConfigPath(),
  });
  const result = await readRuntimeLog({
    logPath: runtimeStatus.logPath,
    lines,
  });
  if (!result.text) {
    console.log(`No logs at ${result.logPath}`);
    return;
  }

  console.log(result.text);
  await printDiagnosticsAfterLogTail();
}
