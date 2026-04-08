import { closeSync, existsSync, openSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { kill } from "node:process";
import { loadConfig } from "../config/load-config.ts";
import { renderDefaultConfigTemplate } from "../config/template.ts";
import { TmuxClient } from "../runners/tmux/client.ts";
import {
  DEFAULT_CONFIG_PATH,
  DEFAULT_RUNTIME_LOG_PATH,
  DEFAULT_RUNTIME_PID_PATH,
  DEFAULT_TMUX_SOCKET_PATH,
  ensureDir,
  expandHomePath,
} from "../shared/paths.ts";
import type { ConfigBootstrapOptions } from "../config/config-file.ts";

const START_WAIT_TIMEOUT_MS = 10_000;
const STOP_WAIT_TIMEOUT_MS = 10_000;
const PROCESS_POLL_INTERVAL_MS = 100;

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

export function readRuntimePid(pidPath = DEFAULT_RUNTIME_PID_PATH) {
  const expandedPidPath = expandHomePath(pidPath);
  if (!existsSync(expandedPidPath)) {
    return null;
  }

  const raw = Bun.file(expandedPidPath).text();
  return raw.then((value) => {
    const pid = Number.parseInt(value.trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  });
}

export function isProcessRunning(pid: number) {
  try {
    kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function ensureConfigFile(
  configPath = DEFAULT_CONFIG_PATH,
  options: ConfigBootstrapOptions = {},
) {
  const expandedConfigPath = expandHomePath(configPath);
  await ensureDir(dirname(expandedConfigPath));

  if (existsSync(expandedConfigPath)) {
    return {
      configPath: expandedConfigPath,
      created: false,
    };
  }

  await Bun.write(
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
}) {
  const pidPath = expandHomePath(params.pidPath ?? DEFAULT_RUNTIME_PID_PATH);
  const logPath = expandHomePath(params.logPath ?? DEFAULT_RUNTIME_LOG_PATH);
  const existingPid = await readRuntimePid(pidPath);
  if (existingPid && isProcessRunning(existingPid)) {
    return {
      alreadyRunning: true,
      createdConfig: false,
      pid: existingPid,
      configPath: expandHomePath(params.configPath ?? DEFAULT_CONFIG_PATH),
      logPath,
    } satisfies RuntimeStartResult;
  }

  if (existingPid) {
    rmSync(pidPath, { force: true });
  }

  const configResult = await ensureConfigFile(params.configPath);
  await ensureDir(dirname(pidPath));
  await ensureDir(dirname(logPath));
  const logStartOffset = getLogSize(logPath);

  const logFd = openSync(logPath, "a");
  const child = Bun.spawn(
    [process.execPath, params.scriptPath, "serve-foreground"],
    {
      stdin: "ignore",
      stdout: logFd,
      stderr: logFd,
      detached: true,
      env: {
        ...process.env,
        MUXBOT_CONFIG_PATH: configResult.configPath,
        MUXBOT_PID_PATH: pidPath,
        MUXBOT_LOG_PATH: logPath,
      },
    },
  );
  closeSync(logFd);
  child.unref();

  const started = await waitForStart({
    pidPath,
    childPid: child.pid,
    timeoutMs: START_WAIT_TIMEOUT_MS,
  });
  if (!started.ok) {
    const cleanedUp = await cleanupFailedStartChild(started);
    const reason = renderStartFailureReason(started, pidPath, cleanedUp);
    throw new StartDetachedRuntimeError(
      `muxbot failed to start within ${START_WAIT_TIMEOUT_MS}ms (${reason}). Check ${logPath}`,
      logPath,
      logStartOffset,
    );
  }

  const runtimePid = started.pid;

  return {
    alreadyRunning: false,
    createdConfig: configResult.created,
    pid: runtimePid ?? child.pid,
    configPath: configResult.configPath,
    logPath,
  } satisfies RuntimeStartResult;
}

export async function stopDetachedRuntime(params: {
  pidPath?: string;
  hard?: boolean;
  configPath?: string;
}) {
  const pidPath = expandHomePath(params.pidPath ?? DEFAULT_RUNTIME_PID_PATH);
  const existingPid = await readRuntimePid(pidPath);
  let stopped = false;

  if (existingPid && isProcessRunning(existingPid)) {
    kill(existingPid, "SIGTERM");
    const exited = await waitForProcessExit(existingPid, STOP_WAIT_TIMEOUT_MS);
    if (!exited) {
      throw new Error(`muxbot did not stop within ${STOP_WAIT_TIMEOUT_MS}ms`);
    }
    stopped = true;
  }

  rmSync(pidPath, { force: true });

  if (params.hard) {
    const socketPath = await resolveTmuxSocketPath(params.configPath);
    const tmux = new TmuxClient(socketPath);
    try {
      await tmux.killServer();
    } catch {
      // No muxbot tmux server is also an acceptable hard-stop outcome.
    }
  }

  return {
    stopped,
  };
}

export async function writeRuntimePid(pidPath = DEFAULT_RUNTIME_PID_PATH, pid = process.pid) {
  const expandedPidPath = expandHomePath(pidPath);
  await ensureDir(dirname(expandedPidPath));
  await Bun.write(expandedPidPath, `${pid}\n`);
}

export function removeRuntimePid(pidPath = DEFAULT_RUNTIME_PID_PATH) {
  rmSync(expandHomePath(pidPath), { force: true });
}

export async function getRuntimeStatus(params: {
  configPath?: string;
  pidPath?: string;
  logPath?: string;
} = {}): Promise<RuntimeStatus> {
  const configPath = expandHomePath(params.configPath ?? DEFAULT_CONFIG_PATH);
  const pidPath = expandHomePath(params.pidPath ?? DEFAULT_RUNTIME_PID_PATH);
  const logPath = expandHomePath(params.logPath ?? DEFAULT_RUNTIME_LOG_PATH);
  const pid = await readRuntimePid(pidPath);

  return {
    running: Boolean(pid && isProcessRunning(pid)),
    pid: pid && isProcessRunning(pid) ? pid : undefined,
    configPath,
    pidPath,
    logPath,
    tmuxSocketPath: await resolveTmuxSocketPath(configPath),
  };
}

export async function readRuntimeLog(params: {
  logPath?: string;
  lines?: number;
  startOffset?: number;
} = {}) {
  const logPath = expandHomePath(params.logPath ?? DEFAULT_RUNTIME_LOG_PATH);
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
  const file = Bun.file(logPath);
  if (startOffset == null || startOffset <= 0) {
    return await file.text();
  }

  return await file.slice(startOffset).text();
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

    await Bun.sleep(PROCESS_POLL_INTERVAL_MS);
  }

  return {
    ok: false,
    reason: isProcessRunning(params.childPid)
      ? "child-running-without-pid"
      : "timed-out",
    childPid: params.childPid,
  };
}

async function waitForProcessExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await Bun.sleep(PROCESS_POLL_INTERVAL_MS);
  }
  return !isProcessRunning(pid);
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
    ? `; muxbot terminated the orphan runtime pid ${result.childPid}`
    : "";

  if (result.reason === "child-exited-before-pid") {
    return `runtime exited before writing pid file ${pidPath}`;
  }

  if (result.reason === "child-running-without-pid") {
    return `runtime is still running but did not write pid file ${pidPath}${cleanupSuffix}`;
  }

  return `runtime did not become ready and no pid file was written to ${pidPath}${cleanupSuffix}`;
}

async function resolveTmuxSocketPath(configPath = DEFAULT_CONFIG_PATH) {
  const expandedConfigPath = expandHomePath(configPath);
  if (!existsSync(expandedConfigPath)) {
    return expandHomePath(DEFAULT_TMUX_SOCKET_PATH);
  }

  try {
    const loaded = await loadConfig(expandedConfigPath);
    return loaded.raw.tmux.socketPath;
  } catch {
    try {
      const text = await Bun.file(expandedConfigPath).text();
      const parsed = JSON.parse(text) as { tmux?: { socketPath?: string } };
      if (typeof parsed.tmux?.socketPath === "string" && parsed.tmux.socketPath.trim()) {
        return expandHomePath(parsed.tmux.socketPath);
      }
    } catch {
      return expandHomePath(DEFAULT_TMUX_SOCKET_PATH);
    }
  }

  return expandHomePath(DEFAULT_TMUX_SOCKET_PATH);
}
