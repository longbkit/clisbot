import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { kill } from "node:process";
import { loadConfig } from "../../config/core/load-config.ts";
import { renderDefaultConfigTemplate } from "../../config/core/template.ts";
import { readEditableConfig, writeEditableConfig } from "../../config/core/config-file.ts";
import { deactivateExpiredMemBots } from "../../config/channels/channel-bot-management.ts";
import { ensureClisbotWrapper } from "../commands/clisbot-wrapper.ts";
import { TmuxClient } from "../../runners/tmux/client.ts";
import { readTextFile, readTextFileSlice, writeTextFile } from "../../infra/fs.ts";
import {
  ensureDir,
  expandHomePath,
  getDefaultTmuxSocketPath,
} from "../../infra/paths.ts";
import { sleep } from "../../infra/process.ts";
import type { ConfigBootstrapOptions } from "../../config/core/config-file.ts";
import { removeRuntimeCredentials } from "../../config/channels/channel-credentials.ts";
import {
  readRuntimeMonitorState,
  writeRuntimeMonitorState,
  type RuntimeMonitorState,
} from "./runtime-monitor.ts";
import {
  getProcessLiveness,
  processMatchesRuntimeRole,
  type ProcessLiveness,
  type RuntimeProcessRole,
} from "./process-inspection.ts";
import {
  resolveRuntimeConfigPath,
  resolveRuntimeCredentialsPath,
  resolveRuntimeLogPath,
  resolveRuntimeMonitorStatePath,
  resolveRuntimePidPath,
} from "./runtime-paths.ts";

export { getProcessLiveness } from "./process-inspection.ts";

const START_WAIT_TIMEOUT_MS = 10_000;
const STOP_WAIT_TIMEOUT_MS = 10_000;
const PROCESS_POLL_INTERVAL_MS = 100;

type RuntimeProcessMatcher = (params: {
  pid: number;
  expectedStartedAt?: string;
  role: RuntimeProcessRole;
}) => boolean;

function resolveLiveMonitorPid(params: {
  pidFromFile: number | null;
  monitorState: RuntimeMonitorState | null;
  processLiveness?: (pid: number) => ProcessLiveness;
  processMatcher?: RuntimeProcessMatcher;
}) {
  const monitorPid = params.monitorState?.monitorPid;
  const processLiveness = params.processLiveness ?? getProcessLiveness;
  const processMatcher = params.processMatcher ?? ((candidate) =>
    processMatchesRuntimeRole(candidate, { processLiveness }));
  if (!monitorPid) {
    const pidFromFile = params.pidFromFile;
    return pidFromFile && processMatcher({
      pid: pidFromFile,
      role: "serve-monitor",
    }) ? pidFromFile : null;
  }
  return processMatcher({
    pid: monitorPid,
    expectedStartedAt: params.monitorState!.startedAt,
    role: "serve-monitor",
  }) ? monitorPid : null;
}

function resolveLiveRuntimePid(params: {
  monitorState: RuntimeMonitorState | null;
  processLiveness?: (pid: number) => ProcessLiveness;
  processMatcher?: RuntimeProcessMatcher;
}) {
  const runtimePid = params.monitorState?.runtimePid;
  if (!runtimePid || params.monitorState?.phase !== "active") {
    return null;
  }
  const processLiveness = params.processLiveness ?? getProcessLiveness;
  const processMatcher = params.processMatcher ?? ((candidate) =>
    processMatchesRuntimeRole(candidate, { processLiveness }));
  return processMatcher({
    pid: runtimePid,
    expectedStartedAt: params.monitorState.updatedAt,
    role: "serve-foreground",
  }) ? runtimePid : null;
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

export type { ProcessLiveness } from "./process-inspection.ts";

export function readRuntimePid(pidPath?: string) {
  const expandedPidPath = resolveRuntimePidPath(pidPath);
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

export async function ensureConfigFile(
  configPath?: string,
  options: ConfigBootstrapOptions = {},
) {
  await ensureClisbotWrapper();
  const expandedConfigPath = resolveRuntimeConfigPath(configPath);
  await ensureDir(dirname(expandedConfigPath));

  if (existsSync(expandedConfigPath)) {
    return {
      configPath: expandedConfigPath,
      created: false,
    };
  }

  await writeTextFile(
    expandedConfigPath,
    renderDefaultConfigTemplate(options),
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
  const configPath = resolveRuntimeConfigPath(params.configPath);
  const preferConfigSibling = params.configPath != null;
  const pidPath = resolveRuntimePidPath(params.pidPath, configPath, { preferConfigSibling });
  const logPath = resolveRuntimeLogPath(params.logPath, configPath, { preferConfigSibling });
  const monitorStatePath = resolveRuntimeMonitorStatePath(params.monitorStatePath, configPath, {
    preferConfigSibling,
  });
  const runtimeCredentialsPath = resolveRuntimeCredentialsPath(
    params.runtimeCredentialsPath,
    configPath,
    { preferConfigSibling },
  );
  const existingPid = await readRuntimePid(pidPath);
  const existingMonitorState = await readRuntimeMonitorState(monitorStatePath);
  const liveMonitorPid = resolveLiveMonitorPid({
    pidFromFile: existingPid,
    monitorState: existingMonitorState,
  });
  if (liveMonitorPid) {
    if (existingPid !== liveMonitorPid) {
      await writeRuntimePid(pidPath, liveMonitorPid);
    }
    return {
      alreadyRunning: true,
      createdConfig: false,
      pid: liveMonitorPid,
      configPath,
      logPath,
    } satisfies RuntimeStartResult;
  }

  if (existingPid) {
    rmSync(pidPath, { force: true });
  }

  const orphanedRuntimePid = resolveLiveRuntimePid({
    monitorState: existingMonitorState,
  });
  if (orphanedRuntimePid && existingMonitorState) {
    kill(orphanedRuntimePid, "SIGTERM");
    const exited = await waitForProcessExit(orphanedRuntimePid, STOP_WAIT_TIMEOUT_MS);
    if (!exited) {
      throw new Error(
        `A stale clisbot runtime worker (${orphanedRuntimePid}) is still running without its monitor; stop it before starting a new service.`,
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
  processMatcher?: RuntimeProcessMatcher;
  sendSignal?: typeof kill;
  sleep?: typeof sleep;
} = {}) {
  const configPath = resolveRuntimeConfigPath(params.configPath);
  const preferConfigSibling = params.configPath != null;
  const pidPath = resolveRuntimePidPath(params.pidPath, configPath, { preferConfigSibling });
  const monitorStatePath = resolveRuntimeMonitorStatePath(params.monitorStatePath, configPath, {
    preferConfigSibling,
  });
  const runtimeCredentialsPath = resolveRuntimeCredentialsPath(
    params.runtimeCredentialsPath,
    configPath,
    { preferConfigSibling },
  );
  const existingPid = await readRuntimePid(pidPath);
  const monitorState = await readRuntimeMonitorState(monitorStatePath);
  let stopped = false;
  const processLiveness = dependencies.processLiveness ?? getProcessLiveness;
  const processMatcher = dependencies.processMatcher ?? ((candidate) =>
    processMatchesRuntimeRole(candidate, { processLiveness }));
  const sendSignal = dependencies.sendSignal ?? kill;
  const sleepFn = dependencies.sleep ?? sleep;

  const monitorPid = resolveLiveMonitorPid({
    pidFromFile: existingPid,
    monitorState,
    processLiveness,
    processMatcher,
  });
  const knownMonitorPid = monitorState?.monitorPid ?? existingPid;
  const knownMonitorLiveness = knownMonitorPid
    ? processLiveness(knownMonitorPid)
    : "missing";
  if (monitorPid) {
    sendSignal(monitorPid, "SIGTERM");
    const exited = await waitForProcessExit(monitorPid, STOP_WAIT_TIMEOUT_MS, {
      processLiveness,
      sleep: sleepFn,
    });
    if (!exited) {
      throw new Error(`clisbot did not stop within ${STOP_WAIT_TIMEOUT_MS}ms`);
    }
    stopped = true;
  } else if (knownMonitorPid && knownMonitorLiveness === "zombie") {
    stopped = true;
  }

  const runtimePid = resolveLiveRuntimePid({
    monitorState,
    processLiveness,
    processMatcher,
  });
  if (runtimePid) {
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
      if (!monitorPid) {
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
  const resolvedConfigPath = resolveRuntimeConfigPath(configPath);
  if (!existsSync(resolvedConfigPath)) {
    return;
  }

  const { config } = await readEditableConfig(resolvedConfigPath);
  const lifecycleLines = deactivateExpiredMemBots(config);
  if (lifecycleLines.length === 0) {
    return;
  }

  await writeEditableConfig(resolvedConfigPath, config);
}

export async function writeRuntimePid(pidPath?: string, pid = process.pid) {
  const expandedPidPath = resolveRuntimePidPath(pidPath);
  await ensureDir(dirname(expandedPidPath));
  await writeTextFile(expandedPidPath, `${pid}\n`);
}

export function removeRuntimePid(pidPath?: string) {
  rmSync(resolveRuntimePidPath(pidPath), { force: true });
}

export async function getRuntimeStatus(params: {
  configPath?: string;
  pidPath?: string;
  logPath?: string;
  monitorStatePath?: string;
} = {}): Promise<RuntimeStatus> {
  const configPath = resolveRuntimeConfigPath(params.configPath);
  const preferConfigSibling = params.configPath != null;
  const pidPath = resolveRuntimePidPath(params.pidPath, configPath, { preferConfigSibling });
  const logPath = resolveRuntimeLogPath(params.logPath, configPath, { preferConfigSibling });
  const monitorStatePath = resolveRuntimeMonitorStatePath(params.monitorStatePath, configPath, {
    preferConfigSibling,
  });
  const pid = await readRuntimePid(pidPath);
  const monitorState = await readRuntimeMonitorState(monitorStatePath);
  const liveMonitorPid = resolveLiveMonitorPid({
    pidFromFile: pid,
    monitorState,
  });
  const liveRuntimePid = resolveLiveRuntimePid({ monitorState });

  return {
    running: liveMonitorPid != null,
    pid: liveMonitorPid ?? undefined,
    configPath,
    pidPath,
    logPath,
    tmuxSocketPath: await resolveTmuxSocketPath(configPath),
    monitorStatePath,
    serviceMode: "monitor",
    serviceState: monitorState?.phase,
    runtimePid: liveRuntimePid ?? undefined,
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
  const logPath = resolveRuntimeLogPath(params.logPath);
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
  const expandedConfigPath = resolveRuntimeConfigPath(configPath);
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
