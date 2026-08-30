// COMPAT(clisbot-hub-local): local lifecycle + discovery for the fork's embedded
// Hub. `hub start` spawns the `@getpaseo/hub` bin detached (default loopback :6868,
// the fork default distinct from upstream's :3000) and records url + pid in
// `hub-local.json` under the shared Clisbot home ($CLISBOT_HOME, default ~/.clisbot);
// the `channels`/`users` verbs read that file to reach the control plane without
// `CLISBOT_HUB_URL`/`CLISBOT_HUB_API_KEY` to set. `hub stop` signals the recorded
// owner pid and removes the state file. Mirrors the daemon's `local-daemon.ts`
// pattern applied to the Hub's exported bin entry (implementation doc §2 step 3, §3.2).

import { spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs, { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawnProcess } from "@getpaseo/server";

const require = createRequire(import.meta.url);

const HUB_STATE_FILENAME = "hub-local.json";
// The fork's default Hub port (implementation doc §3.2), distinct from upstream's 3000.
const FORK_DEFAULT_HUB_PORT = 6868;
// The Hub binds loopback; the embedded control plane trusts loopback only.
const FORK_HUB_BIND = "127.0.0.1";
const FORK_DEFAULT_HOME_DIRECTORY_NAME = ".clisbot";

const DETACHED_STARTUP_GRACE_MS = 1200;
const PID_POLL_INTERVAL_MS = 100;
const HUB_LOG_FILENAME = "hub.log";
export const DEFAULT_STOP_TIMEOUT_MS = 15_000;
export const DEFAULT_KILL_TIMEOUT_MS = 3_000;

const HUB_STATE_VERSION = 1;

export class AlreadyRunningError extends Error {
  constructor(
    readonly url: string,
    readonly pid: number,
  ) {
    super(`A Hub is already running at ${url} (PID ${pid})`);
    this.name = "AlreadyRunningError";
  }
}

export interface HubStartOptions {
  home?: string;
  port?: string;
  foreground?: boolean;
}

export interface HubStateRecord {
  version: number;
  url: string;
  port: number;
  pid: number;
  startedAt?: string;
}

export interface LocalHubState {
  home: string;
  statePath: string;
  logPath: string;
  state: HubStateRecord | null;
  running: boolean;
  staleStateFile: boolean;
}

export interface DetachedStartResult {
  pid: number | null;
  logPath: string;
  url: string;
}

export interface StopLocalHubOptions {
  home?: string;
  timeoutMs?: number;
  killTimeoutMs?: number;
  force?: boolean;
}

export interface StopLocalHubResult {
  action: "stopped" | "not_running";
  home: string;
  pid: number | null;
  forced: boolean;
  reason: "not_running" | "owner_pid_signal" | "owner_pid_sigkill";
  message: string;
}

export interface LocalHubStatus {
  home: string;
  url: string | null;
  pid: number | null;
  running: boolean;
}

export interface HubLocalProcess extends Pick<ChildProcess, "once" | "pid" | "unref"> {}

export interface HubLaunchRuntime {
  resolveHubBin(): string;
  spawnDetached(
    command: string,
    args: string[],
    options: Parameters<typeof spawnProcess>[2],
  ): HubLocalProcess;
  spawnForeground(
    command: string,
    args: string[],
    options: SpawnOptions,
  ): { status: number | null; error?: Error };
  fetchHealth(url: string): Promise<boolean>;
}

interface ProcessExitDetails {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

type DetachedStartupResult = { exitedEarly: false } | ({ exitedEarly: true } & ProcessExitDetails);

const defaultHubLaunchRuntime: HubLaunchRuntime = {
  resolveHubBin: resolveHubBin,
  spawnDetached: spawnProcess,
  spawnForeground: (command, args, options) => spawnSync(command, args, options),
  fetchHealth: fetchHealth,
};

function isSet(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

/**
 * The shared Clisbot home. `hub start` records `hub-local.json` here so the local
 * verbs discover the running Hub. Resolution mirrors the fork's env-alias
 * precedence: explicit flag (handled by callers), `CLISBOT_HOME`, `PASEO_HOME`,
 * then the default `~/.clisbot` (implementation doc §4.5 / plan §14.8).
 */
export function resolveLocalHubHome(
  options: { home?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (isSet(options.home)) return options.home;
  if (isSet(env.CLISBOT_HOME)) return env.CLISBOT_HOME;
  if (isSet(env.PASEO_HOME)) return env.PASEO_HOME;
  return path.join(os.homedir(), FORK_DEFAULT_HOME_DIRECTORY_NAME);
}

export function hubStatePath(home: string): string {
  return path.join(home, HUB_STATE_FILENAME);
}

export function readHubStateFile(home: string): HubStateRecord | null {
  const statePath = hubStatePath(home);
  if (!existsSync(statePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf-8")) as Record<string, unknown>;
    const pid = parsed.pid;
    const port = parsed.port;
    const url = parsed.url;
    if (
      typeof pid !== "number" ||
      !Number.isInteger(pid) ||
      pid <= 0 ||
      typeof port !== "number" ||
      !Number.isInteger(port) ||
      port <= 0 ||
      typeof url !== "string"
    ) {
      return null;
    }
    const startedAt = typeof parsed.startedAt === "string" ? parsed.startedAt : undefined;
    return {
      version: typeof parsed.version === "number" ? parsed.version : HUB_STATE_VERSION,
      url,
      port,
      pid,
      startedAt,
    };
  } catch {
    return null;
  }
}

function writeHubStateFile(home: string, record: HubStateRecord): void {
  writeFileSync(hubStatePath(home), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function removeHubStateFile(home: string): void {
  try {
    rmSync(hubStatePath(home), { force: true });
  } catch {
    // Best-effort cleanup; the successful stop is authoritative.
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return readNodeErrnoCode(error) === "EPERM";
  }
  // The probe passes for zombies too: the task still exists in the kernel,
  // it has merely exited. Under an init that does not reap (a container
  // whose pid 1 does not waitpid on detached children) a dead Hub stays a
  // zombie forever and the probe reports it "running" forever — wedging
  // `hub stop` (15s wait) and blocking `hub start` on a free port. Where
  // /proc is available the kernel state is authoritative; only `Z` (zombie)
  // means exited.
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    return !/State:\s+Z(\s|$)/u.test(status);
  } catch {
    // /proc unavailable, or the process exited between the probe and the
    // read: the probe stands.
  }
  return true;
}

function readNodeErrnoCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function signalProcess(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    return readNodeErrnoCode(error) !== "ESRCH";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function tailFile(filePath: string, lines = 30): string | null {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return content.split("\n").filter(Boolean).slice(-lines).join("\n");
  } catch {
    return null;
  }
}

export function resolveHubPort(options: { port?: string }): number {
  const raw = options.port ?? String(FORK_DEFAULT_HUB_PORT);
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid hub port: ${raw}`);
  }
  return port;
}

function hubUrlFor(port: number): string {
  return `http://${FORK_HUB_BIND}:${port}`;
}

function resolveHubBin(): string {
  // @getpaseo/hub has no main/exports entry; resolve the package root via its
  // package.json subpath and use the documented bin entry.
  const packageJsonPath = require.resolve("@getpaseo/hub/package.json");
  const packageRoot = path.dirname(packageJsonPath);
  const binPath = path.join(packageRoot, "bin", "paseo-hub.js");
  if (!existsSync(binPath)) {
    throw new Error(`Hub bin entry not found at ${binPath}. Run \`npm run build:hub\` first.`);
  }
  return binPath;
}

async function fetchHealth(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (!isProcessRunning(pid)) return true;
    if (Date.now() >= deadline) return !isProcessRunning(pid);
    await sleep(PID_POLL_INTERVAL_MS);
  }
}

export function resolveLocalHubState(
  options: { home?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): LocalHubState {
  const home = resolveLocalHubHome(options, env);
  const state = readHubStateFile(home);
  const running = state !== null && isProcessRunning(state.pid);
  return {
    home,
    statePath: hubStatePath(home),
    logPath: path.join(home, HUB_LOG_FILENAME),
    state,
    running,
    staleStateFile: state !== null && !running,
  };
}

function detachedStartupWatch(
  child: HubLocalProcess,
  graceMs: number,
): Promise<DetachedStartupResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: DetachedStartupResult): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish({ exitedEarly: false }), graceMs);
    child.once("error", (error: Error) => {
      clearTimeout(timer);
      finish({ exitedEarly: true, code: null, signal: null, error });
    });
    child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      finish({ exitedEarly: true, code, signal });
    });
  });
}

function buildChildEnv(home: string, port: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    PASEO_HUB_BIND: FORK_HUB_BIND,
    PASEO_HOME: home,
  };
  const password = readDaemonPasswordFile(home);
  if (password !== undefined) env.PASEO_PASSWORD = password;
  return env;
}

/**
 * The daemon's WS-auth password, when the home carries `<home>/.daemon-password`.
 * Without it a password-protected daemon rejects the Hub's trusted session at
 * the WS upgrade ("started" hub, dead daemon link). The file is a single
 * `PASEO_PASSWORD=<value>` line (the repo .env shape), not a bare value — split
 * on the first `=`. An absent or unreadable file returns undefined: a daemon
 * without a password needs none.
 */
export function readDaemonPasswordFile(home: string): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(path.join(home, ".daemon-password"), "utf8");
  } catch {
    return undefined;
  }
  const value = raw.trim();
  if (value.length === 0) return undefined;
  const eq = value.indexOf("=");
  return (eq > 0 ? value.slice(eq + 1).trim() : value) || undefined;
}

export async function startLocalHubDetached(
  options: HubStartOptions = {},
  runtime: HubLaunchRuntime = defaultHubLaunchRuntime,
): Promise<DetachedStartResult> {
  const home = resolveLocalHubHome(options);
  const port = resolveHubPort(options);
  const url = hubUrlFor(port);
  const existing = readHubStateFile(home);
  if (existing !== null && isProcessRunning(existing.pid)) {
    throw new AlreadyRunningError(existing.url, existing.pid);
  }
  // The detached Hub's stdout/stderr land in `hub.log` (the path this command
  // reports and reads on failure); discarding them left the log empty.
  const logFd = fs.openSync(path.join(home, HUB_LOG_FILENAME), "a");
  const child = runtime.spawnDetached(process.execPath, [runtime.resolveHubBin()], {
    detached: true,
    envMode: "internal",
    env: buildChildEnv(home, port),
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  const startup = await detachedStartupWatch(child, DETACHED_STARTUP_GRACE_MS);
  if (startup.exitedEarly) {
    const reason = startup.error
      ? startup.error.message
      : `exit code ${startup.code ?? "unknown"}${startup.signal ? ` (${startup.signal})` : ""}`;
    const logPath = path.join(home, HUB_LOG_FILENAME);
    const recentLogs = tailFile(logPath);
    removeHubStateFile(home);
    throw new Error(
      [
        `Hub failed to start in background (${reason}).`,
        recentLogs ? `Recent hub logs:\n${recentLogs}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
  writeHubStateFile(home, {
    version: HUB_STATE_VERSION,
    url,
    port,
    pid: child.pid ?? 0,
    startedAt: new Date().toISOString(),
  });
  return { pid: child.pid ?? null, logPath: path.join(home, HUB_LOG_FILENAME), url };
}

export function startLocalHubForeground(
  options: HubStartOptions = {},
  runtime: HubLaunchRuntime = defaultHubLaunchRuntime,
): number {
  const home = resolveLocalHubHome(options);
  const port = resolveHubPort(options);
  const result = runtime.spawnForeground(process.execPath, [runtime.resolveHubBin()], {
    env: buildChildEnv(home, port),
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

export async function getLocalHubStatus(
  options: { home?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<LocalHubStatus> {
  const state = resolveLocalHubState(options, env);
  return {
    home: state.home,
    url: state.state?.url ?? null,
    pid: state.state?.pid ?? null,
    running: state.running,
  };
}

export async function stopLocalHub(options: StopLocalHubOptions = {}): Promise<StopLocalHubResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  const killTimeoutMs = options.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS;
  const state = resolveLocalHubState({ home: options.home });
  const pid = state.state?.pid ?? null;

  if (pid === null || !isProcessRunning(pid)) {
    const staleSuffix =
      state.staleStateFile && state.state ? ` (stale state file for ${state.state.pid})` : "";
    removeHubStateFile(state.home);
    return {
      action: "not_running",
      home: state.home,
      pid,
      forced: false,
      reason: "not_running",
      message: `Hub is not running${staleSuffix}`,
    };
  }

  const signaled = signalProcess(pid, "SIGTERM");
  if (!signaled) {
    removeHubStateFile(state.home);
    return {
      action: "not_running",
      home: state.home,
      pid,
      forced: false,
      reason: "not_running",
      message: "Hub process was already stopped",
    };
  }

  let stopped = await waitForPidExit(pid, timeoutMs);
  let forced = false;
  if (!stopped && options.force === true) {
    signalProcess(pid, "SIGKILL");
    stopped = await waitForPidExit(pid, killTimeoutMs);
    forced = true;
  }
  if (!stopped) {
    throw new Error(
      `Timed out waiting for Hub PID ${pid} to stop after ${Math.ceil(timeoutMs / 1000)}s`,
    );
  }
  removeHubStateFile(state.home);
  return {
    action: "stopped",
    home: state.home,
    pid,
    forced,
    reason: forced ? "owner_pid_sigkill" : "owner_pid_signal",
    message: forced ? "Hub owner process was force-stopped" : "Hub stopped via owner PID signal",
  };
}
