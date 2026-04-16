import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { kill } from "node:process";
import { loadConfig } from "../config/load-config.ts";
import { renderDefaultConfigTemplate } from "../config/template.ts";
import { readEditableConfig, writeEditableConfig } from "../config/config-file.ts";
import { deactivateExpiredMemAccounts } from "../config/channel-account-management.ts";
import { ensureClisbotWrapper } from "./clisbot-wrapper.ts";
import { TmuxClient } from "../runners/tmux/client.ts";
import { readTextFile, readTextFileSlice, writeTextFile } from "../shared/fs.ts";
import {
  ensureDir,
  expandHomePath,
  getDefaultConfigPath,
  getDefaultRuntimeLogPath,
  getDefaultRuntimeMonitorStatePath,
  getDefaultRuntimeCredentialsPath,
  getDefaultRuntimePidPath,
  getDefaultTmuxSocketPath,
} from "../shared/paths.ts";
import { sleep } from "../shared/process.ts";
import type { ConfigBootstrapOptions } from "../config/config-file.ts";
import { removeRuntimeCredentials } from "../config/channel-credentials.ts";
import {
  readRuntimeMonitorState,
  writeRuntimeMonitorState,
  type RuntimeMonitorState,
} from "./runtime-monitor.ts";

const START_WAIT_TIMEOUT_MS = 10_000;
const STOP_WAIT_TIMEOUT_MS = 10_000;
const PROCESS_POLL_INTERVAL_MS = 100;

function resolveConfigPath(configPath?: string) {
  return expandHomePath(configPath ?? process.env.CLISBOT_CONFIG_PATH ?? getDefaultConfigPath());
}

function deriveRuntimeSiblingPath(
  configPath: string | undefined,
  filename: string,
) {
  if (!configPath) {
    return null;
  }

  return join(dirname(expandHomePath(configPath)), "state", filename);
}

function resolvePidPath(pidPath?: string, configPath?: string) {
  if (pidPath) {
    return expandHomePath(pidPath);
  }

  if (process.env.CLISBOT_PID_PATH) {
    return expandHomePath(process.env.CLISBOT_PID_PATH);
  }

  const derivedFromConfig = deriveRuntimeSiblingPath(
    configPath ?? process.env.CLISBOT_CONFIG_PATH,
    "clisbot.pid",
  );
  if (derivedFromConfig) {
    return derivedFromConfig;
  }

  return expandHomePath(getDefaultRuntimePidPath());
}

function resolveLogPath(logPath?: string, configPath?: string) {
  if (logPath) {
    return expandHomePath(logPath);
  }

  if (process.env.CLISBOT_LOG_PATH) {
    return expandHomePath(process.env.CLISBOT_LOG_PATH);
  }

  const derivedFromConfig = deriveRuntimeSiblingPath(
    configPath ?? process.env.CLISBOT_CONFIG_PATH,
    "clisbot.log",
  );
  if (derivedFromConfig) {
    return derivedFromConfig;
  }

  return expandHomePath(getDefaultRuntimeLogPath());
}

function resolveMonitorStatePath(monitorStatePath?: string, configPath?: string) {
  if (monitorStatePath) {
    return expandHomePath(monitorStatePath);
  }

  if (process.env.CLISBOT_RUNTIME_MONITOR_STATE_PATH) {
    return expandHomePath(process.env.CLISBOT_RUNTIME_MONITOR_STATE_PATH);
  }

  const derivedFromConfig = deriveRuntimeSiblingPath(
    configPath ?? process.env.CLISBOT_CONFIG_PATH,
    "clisbot-monitor.json",
  );
  if (derivedFromConfig) {
    return derivedFromConfig;
  }

  return expandHomePath(getDefaultRuntimeMonitorStatePath());
}

function resolveRuntimeCredentialsPath(runtimeCredentialsPath?: string, configPath?: string) {
  if (runtimeCredentialsPath) {
    return expandHomePath(runtimeCredentialsPath);
  }

  if (process.env.CLISBOT_RUNTIME_CREDENTIALS_PATH) {
    return expandHomePath(process.env.CLISBOT_RUNTIME_CREDENTIALS_PATH);
  }

  const derivedFromConfig = deriveRuntimeSiblingPath(
    configPath ?? process.env.CLISBOT_CONFIG_PATH,
    "runtime-credentials.json",
  );
  if (derivedFromConfig) {
    return derivedFromConfig;
  }

  return expandHomePath(getDefaultRuntimeCredentialsPath());
}

export type RuntimeStartResult = {
  alreadyRunning: boolean;
  createdConfig: boolean;
  pid: number;
  configPath: string;
  logPath: string;
};

export type RuntimeStatus = {
  running: boolean;
  pid?: number;
  configPath: string;
  pidPath: string;
  logPath: string;
  tmuxSocketPath: string;
  monitorStatePath: string;
  serviceMode: "monitor";
  serviceState?: RuntimeMonitorState["phase"];
  runtimePid?: number;
  nextRestartAt?: string;
  restartNumber?: number;
  restartMode?: NonNullable<RuntimeMonitorState["restart"]>["mode"];
  restartStageIndex?: number;
  stopReason?: RuntimeMonitorState["stopReason"];
};

export class StartDetachedRuntimeError extends Error {
  constructor(
    message: string,
    readonly logPath: string,
    readonly logStartOffset: number,
  ) {
    super(message);
    this.name = "StartDetachedRuntimeError";
  }
}

type WaitForStartResult =
  | { ok: true; pid: number }
  | {
      ok: false;
      reason:
        | "timed-out"
        | "child-exited-before-pid"
        | "child-running-without-pid";
      childPid: number;
    };

export type ProcessLiveness = "running" | "zombie" | "missing";

type ProcessLivenessDependencies = {
  platform: NodeJS.Platform;
  signalCheck: (pid: number) => boolean;
  readLinuxProcStat: (pid: number) => ProcessLiveness | "unknown";
  readPsStat: (pid: number) => ProcessLiveness | "unknown";
};

const DEFAULT_PROCESS_LIVENESS_DEPENDENCIES: ProcessLivenessDependencies = {
  platform: process.platform,
  signalCheck: signalCheckProcess,
  readLinuxProcStat: readLinuxProcStatLiveness,
  readPsStat: readPsStatLiveness,
};

export function readRuntimePid(pidPath?: string) {
  const expandedPidPath = resolvePidPath(pidPath);
  if (!existsSync(expandedPidPath)) {
    return null;
  }

  const raw = readTextFile(expandedPidPath);
  return raw.then((value) => {
    const pid = Number.parseInt(value.trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  });
}

export function isProcessRunning(pid: number) {
  return getProcessLiveness(pid) === "running";
}

export function getProcessLiveness(
  pid: number,
  dependencies: Partial<ProcessLivenessDependencies> = {},
): ProcessLiveness {
  const resolvedDependencies = {
    ...DEFAULT_PROCESS_LIVENESS_DEPENDENCIES,
    ...dependencies,
  } satisfies ProcessLivenessDependencies;

  if (!resolvedDependencies.signalCheck(pid)) {
    return "missing";
  }

  if (resolvedDependencies.platform === "win32") {
    return "running";
  }

  const linuxState = resolvedDependencies.readLinuxProcStat(pid);
  if (linuxState !== "unknown") {
    return linuxState;
  }

  const psState = resolvedDependencies.readPsStat(pid);
  if (psState !== "unknown") {
    return psState;
  }

  return "running";
}

export async function ensureConfigFile(
  configPath?: string,
  options: ConfigBootstrapOptions = {},
) {
  await ensureClisbotWrapper();
  const expandedConfigPath = resolveConfigPath(configPath);
  await ensureDir(dirname(expandedConfigPath));

  if (existsSync(expandedConfigPath)) {
    return {
      configPath: expandedConfigPath,
      created: false,
    };
  }

  await writeTextFile(
    expandedConfigPath,
    renderDefaultConfigTemplate({
      slackEnabled: options.slackEnabled,
      telegramEnabled: options.telegramEnabled,
      slackAppTokenRef: options.slackAppTokenRef,
      slackBotTokenRef: options.slackBotTokenRef,
      telegramBotTokenRef: options.telegramBotTokenRef,
    }),
  );
  return {
    configPath: expandedConfigPath,
    created: true,
  };
}

export async function startDetachedRuntime(params: {
  scriptPath: string;
  configPath?: string;
  pidPath?: string;
  logPath?: string;
  extraEnv?: NodeJS.ProcessEnv;
  runtimeCredentialsPath?: string;
  monitorStatePath?: string;
}) {
  const configPath = resolveConfigPath(params.configPath);
  const pidPath = resolvePidPath(params.pidPath, configPath);
  const logPath = resolveLogPath(params.logPath, configPath);
  const monitorStatePath = resolveMonitorStatePath(params.monitorStatePath, configPath);
  const runtimeCredentialsPath = resolveRuntimeCredentialsPath(params.runtimeCredentialsPath, configPath);
  const existingPid = await readRuntimePid(pidPath);
  const existingMonitorState = await readRuntimeMonitorState(monitorStatePath);
  if (existingPid && isProcessRunning(existingPid)) {
    return {
      alreadyRunning: true,
      createdConfig: false,
      pid: existingPid,
      configPath,
      logPath,
    } satisfies RuntimeStartResult;
  }

  if (existingPid) {
    rmSync(pidPath, { force: true });
  }

  if (existingMonitorState?.runtimePid && isProcessRunning(existingMonitorState.runtimePid)) {
    kill(existingMonitorState.runtimePid, "SIGTERM");
    const exited = await waitForProcessExit(existingMonitorState.runtimePid, STOP_WAIT_TIMEOUT_MS);
    if (!exited) {
      throw new Error(
        `A stale clisbot runtime worker (${existingMonitorState.runtimePid}) is still running without its monitor; stop it before starting a new service.`,
      );
    }
    await writeRuntimeMonitorState(monitorStatePath, {
      ...existingMonitorState,
      phase: "stopped",
      runtimePid: undefined,
      stopReason: "operator-stop",
      updatedAt: new Date().toISOString(),
    });
  }

  const configResult = await ensureConfigFile(params.configPath);
  await ensureDir(dirname(pidPath));
  await ensureDir(dirname(logPath));
  const logStartOffset = getLogSize(logPath);

  const logFd = openSync(logPath, "a");
  const child = spawn(process.execPath, [params.scriptPath, "serve-monitor"], {
    stdio: ["ignore", logFd, logFd],
    detached: true,
    env: {
      ...process.env,
      ...params.extraEnv,
      CLISBOT_CONFIG_PATH: configResult.configPath,
      CLISBOT_PID_PATH: pidPath,
      CLISBOT_LOG_PATH: logPath,
      CLISBOT_RUNTIME_MONITOR_STATE_PATH: monitorStatePath,
      CLISBOT_RUNTIME_CREDENTIALS_PATH: runtimeCredentialsPath,
    },
  });
  closeSync(logFd);
  child.unref();
  const childPid = child.pid;
  if (childPid == null) {
    throw new Error("clisbot failed to spawn detached runtime process");
  }

  const started = await waitForStart({
    pidPath,
    childPid,
    timeoutMs: START_WAIT_TIMEOUT_MS,
  });
  if (!started.ok) {
    const cleanedUp = await cleanupFailedStartChild(started);
    const reason = renderStartFailureReason(started, pidPath, cleanedUp);
    throw new StartDetachedRuntimeError(
      `clisbot failed to start within ${START_WAIT_TIMEOUT_MS}ms (${reason}). Check ${logPath}`,
      logPath,
      logStartOffset,
    );
  }

  const runtimePid = started.pid;

  return {
    alreadyRunning: false,
    createdConfig: configResult.created,
    pid: runtimePid ?? childPid,
    configPath: configResult.configPath,
    logPath,
  } satisfies RuntimeStartResult;
}

export async function stopDetachedRuntime(params: {
  pidPath?: string;
  hard?: boolean;
  configPath?: string;
  runtimeCredentialsPath?: string;
  monitorStatePath?: string;
}, dependencies: {
  processLiveness?: (pid: number) => ProcessLiveness;
  sendSignal?: typeof kill;
  sleep?: typeof sleep;
} = {}) {
  const configPath = resolveConfigPath(params.configPath);
  const pidPath = resolvePidPath(params.pidPath, configPath);
  const monitorStatePath = resolveMonitorStatePath(params.monitorStatePath, configPath);
  const runtimeCredentialsPath = resolveRuntimeCredentialsPath(params.runtimeCredentialsPath, configPath);
  const existingPid = await readRuntimePid(pidPath);
  const monitorState = await readRuntimeMonitorState(monitorStatePath);
  let stopped = false;
  const processLiveness = dependencies.processLiveness ?? getProcessLiveness;
  const sendSignal = dependencies.sendSignal ?? kill;
  const sleepFn = dependencies.sleep ?? sleep;

  const existingLiveness = existingPid ? processLiveness(existingPid) : "missing";
  if (existingPid && existingLiveness === "running") {
    sendSignal(existingPid, "SIGTERM");
    const exited = await waitForProcessExit(existingPid, STOP_WAIT_TIMEOUT_MS, {
      processLiveness,
      sleep: sleepFn,
    });
    if (!exited) {
      throw new Error(`clisbot did not stop within ${STOP_WAIT_TIMEOUT_MS}ms`);
    }
    stopped = true;
  } else if (existingPid && existingLiveness === "zombie") {
    stopped = true;
  }

  const runtimePid = monitorState?.runtimePid;
  if (runtimePid && processLiveness(runtimePid) === "running") {
    try {
      sendSignal(runtimePid, "SIGTERM");
      const exited = await waitForProcessExit(runtimePid, STOP_WAIT_TIMEOUT_MS, {
        processLiveness,
        sleep: sleepFn,
      });
      if (!exited) {
        throw new Error(`clisbot runtime worker did not stop within ${STOP_WAIT_TIMEOUT_MS}ms`);
      }
      stopped = true;
    } catch (error) {
      if (!(existingPid && existingLiveness === "running")) {
        throw error;
      }
    }
  }

  rmSync(pidPath, { force: true });
  removeRuntimeCredentials(runtimeCredentialsPath);
  await disableExpiredMemAccountsInConfig(configPath);
  if (monitorState) {
    await writeRuntimeMonitorState(monitorStatePath, {
      ...monitorState,
      phase: "stopped",
      runtimePid: undefined,
      stopReason: "operator-stop",
      updatedAt: new Date().toISOString(),
    });
  }

  if (params.hard) {
    const socketPath = await resolveTmuxSocketPath(configPath);
    const tmux = new TmuxClient(socketPath);
    try {
      await tmux.killServer();
    } catch {
      // No clisbot tmux server is also an acceptable hard-stop outcome.
    }
  }

  return {
    stopped,
  };
}

async function disableExpiredMemAccountsInConfig(configPath?: string) {
  const resolvedConfigPath = resolveConfigPath(configPath);
  if (!existsSync(resolvedConfigPath)) {
    return;
  }

  const { config } = await readEditableConfig(resolvedConfigPath);
  const lifecycleLines = deactivateExpiredMemAccounts(config);
  if (lifecycleLines.length === 0) {
    return;
  }

  await writeEditableConfig(resolvedConfigPath, config);
}

export async function writeRuntimePid(pidPath?: string, pid = process.pid) {
  const expandedPidPath = resolvePidPath(pidPath);
  await ensureDir(dirname(expandedPidPath));
  await writeTextFile(expandedPidPath, `${pid}\n`);
}

export function removeRuntimePid(pidPath?: string) {
  rmSync(resolvePidPath(pidPath), { force: true });
}

export async function getRuntimeStatus(params: {
  configPath?: string;
  pidPath?: string;
  logPath?: string;
  monitorStatePath?: string;
} = {}): Promise<RuntimeStatus> {
  const configPath = resolveConfigPath(params.configPath);
  const pidPath = resolvePidPath(params.pidPath, configPath);
  const logPath = resolveLogPath(params.logPath, configPath);
  const monitorStatePath = resolveMonitorStatePath(params.monitorStatePath, configPath);
  const pid = await readRuntimePid(pidPath);
  const liveness = pid ? getProcessLiveness(pid) : "missing";
  const monitorState = await readRuntimeMonitorState(monitorStatePath);

  return {
    running: liveness === "running",
    pid: liveness === "running" && pid ? pid : undefined,
    configPath,
    pidPath,
    logPath,
    tmuxSocketPath: await resolveTmuxSocketPath(configPath),
    monitorStatePath,
    serviceMode: "monitor",
    serviceState: monitorState?.phase,
    runtimePid:
      monitorState?.runtimePid && getProcessLiveness(monitorState.runtimePid) === "running"
        ? monitorState.runtimePid
        : undefined,
    nextRestartAt: monitorState?.restart?.nextRestartAt,
    restartNumber: monitorState?.restart?.restartNumber,
    restartMode: monitorState?.restart?.mode,
    restartStageIndex: monitorState?.restart?.stageIndex,
    stopReason: monitorState?.stopReason,
  };
}

export async function readRuntimeLog(params: {
  logPath?: string;
  lines?: number;
  startOffset?: number;
} = {}) {
  const logPath = resolveLogPath(params.logPath);
  const lines = params.lines ?? 200;
  if (!existsSync(logPath)) {
    return {
      logPath,
      text: "",
    };
  }

  const text = await readLogText(logPath, params.startOffset);
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const selected = normalized.split("\n").slice(-lines).join("\n").trim();
  return {
    logPath,
    text: selected,
  };
}

async function readLogText(logPath: string, startOffset?: number) {
  if (startOffset == null || startOffset <= 0) {
    return await readTextFile(logPath);
  }

  return await readTextFileSlice(logPath, startOffset);
}

function getLogSize(logPath: string) {
  if (!existsSync(logPath)) {
    return 0;
  }

  try {
    return statSync(logPath).size;
  } catch {
    return 0;
  }
}

async function waitForStart(params: {
  pidPath: string;
  childPid: number;
  timeoutMs: number;
}): Promise<WaitForStartResult> {
  const deadline = Date.now() + params.timeoutMs;
  while (Date.now() < deadline) {
    const livePid = await readRuntimePid(params.pidPath);
    if (livePid && isProcessRunning(livePid)) {
      return {
        ok: true,
        pid: livePid,
      };
    }

    if (!isProcessRunning(params.childPid)) {
      return {
        ok: false,
        reason: "child-exited-before-pid",
        childPid: params.childPid,
      };
    }

    await sleep(PROCESS_POLL_INTERVAL_MS);
  }

  return {
    ok: false,
    reason: isProcessRunning(params.childPid)
      ? "child-running-without-pid"
      : "timed-out",
    childPid: params.childPid,
  };
}

async function waitForProcessExit(
  pid: number,
  timeoutMs: number,
  dependencies: {
    processLiveness?: (pid: number) => ProcessLiveness;
    sleep?: typeof sleep;
  } = {},
) {
  const processLiveness = dependencies.processLiveness ?? getProcessLiveness;
  const sleepFn = dependencies.sleep ?? sleep;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processLiveness(pid) !== "running") {
      return true;
    }
    await sleepFn(PROCESS_POLL_INTERVAL_MS);
  }
  return processLiveness(pid) !== "running";
}

async function cleanupFailedStartChild(
  result: Exclude<WaitForStartResult, { ok: true }>,
) {
  if (result.reason === "child-exited-before-pid") {
    return false;
  }

  if (!isProcessRunning(result.childPid)) {
    return false;
  }

  try {
    kill(result.childPid, "SIGTERM");
    return await waitForProcessExit(result.childPid, 2_000);
  } catch {
    return false;
  }
}

function renderStartFailureReason(
  result: Exclude<WaitForStartResult, { ok: true }>,
  pidPath: string,
  cleanedUp = false,
) {
  const cleanupSuffix = cleanedUp
    ? `; clisbot terminated the orphan runtime pid ${result.childPid}`
    : "";

  if (result.reason === "child-exited-before-pid") {
    return `service monitor exited before writing pid file ${pidPath}`;
  }

  if (result.reason === "child-running-without-pid") {
    return `service monitor is still running but did not write pid file ${pidPath}${cleanupSuffix}`;
  }

  return `service monitor did not become ready and no pid file was written to ${pidPath}${cleanupSuffix}`;
}

async function resolveTmuxSocketPath(configPath?: string) {
  const expandedConfigPath = resolveConfigPath(configPath);
  if (!existsSync(expandedConfigPath)) {
    return getDefaultTmuxSocketPath();
  }

  try {
    const loaded = await loadConfig(expandedConfigPath);
    return loaded.raw.tmux.socketPath;
  } catch {
    try {
      const text = await readTextFile(expandedConfigPath);
      const parsed = JSON.parse(text) as { tmux?: { socketPath?: string } };
      if (typeof parsed.tmux?.socketPath === "string" && parsed.tmux.socketPath.trim()) {
        return expandHomePath(parsed.tmux.socketPath);
      }
    } catch {
      return getDefaultTmuxSocketPath();
    }
  }

  return getDefaultTmuxSocketPath();
}

function signalCheckProcess(pid: number) {
  try {
    kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLinuxProcStatLiveness(pid: number): ProcessLiveness | "unknown" {
  if (process.platform !== "linux") {
    return "unknown";
  }

  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const state = extractLinuxProcState(raw);
    if (!state) {
      return "unknown";
    }
    return state.includes("Z") ? "zombie" : "running";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return "missing";
    }
    return "unknown";
  }
}

function readPsStatLiveness(pid: number): ProcessLiveness | "unknown" {
  try {
    const raw = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!raw) {
      return "missing";
    }
    return raw.includes("Z") ? "zombie" : "running";
  } catch (error) {
    const commandError = error as NodeJS.ErrnoException & { status?: number | null };
    if (commandError.code === "ENOENT") {
      return "unknown";
    }
    if (commandError.status === 1) {
      return "missing";
    }
    return "unknown";
  }
}

function extractLinuxProcState(raw: string) {
  const closingParenIndex = raw.lastIndexOf(")");
  if (closingParenIndex < 0) {
    return null;
  }

  const remainder = raw.slice(closingParenIndex + 1).trim();
  if (!remainder) {
    return null;
  }

  const [state] = remainder.split(/\s+/, 1);
  return state?.trim() || null;
}
