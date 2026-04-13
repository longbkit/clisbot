import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ensureDir as ensureDirPath, writeTextFile } from "./fs.ts";

const DEFAULT_APP_HOME_BASENAME = ".clisbot";

export function expandHomePath(rawPath: string): string {
  if (rawPath === "~") {
    return homedir();
  }
  if (rawPath.startsWith("~/")) {
    return join(homedir(), rawPath.slice(2));
  }
  return rawPath;
}

export function collapseHomePath(pathname: string): string {
  const home = homedir();
  if (pathname === home) {
    return "~";
  }
  if (pathname.startsWith(`${home}/`)) {
    return `~/${pathname.slice(home.length + 1)}`;
  }
  return pathname;
}

export function resolveAppHomeDir(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.CLISBOT_HOME?.trim();
  if (configured) {
    return expandHomePath(configured);
  }
  return join(homedir(), DEFAULT_APP_HOME_BASENAME);
}

export function getDefaultConfigPath(env: NodeJS.ProcessEnv = process.env) {
  return join(resolveAppHomeDir(env), "clisbot.json");
}

export function getDefaultStateDir(env: NodeJS.ProcessEnv = process.env) {
  return join(resolveAppHomeDir(env), "state");
}

export function getDefaultWorkspaceRoot(env: NodeJS.ProcessEnv = process.env) {
  return join(resolveAppHomeDir(env), "workspaces");
}

export function getDefaultCredentialsDir(env: NodeJS.ProcessEnv = process.env) {
  return join(resolveAppHomeDir(env), "credentials");
}

export function getDefaultTmuxSocketPath(env: NodeJS.ProcessEnv = process.env) {
  return join(getDefaultStateDir(env), "clisbot.sock");
}

export function getDefaultProcessedEventsPath(env: NodeJS.ProcessEnv = process.env) {
  return join(getDefaultStateDir(env), "processed-slack-events.json");
}

export function getDefaultSessionStorePath(env: NodeJS.ProcessEnv = process.env) {
  return join(getDefaultStateDir(env), "sessions.json");
}

export function getDefaultPairingDir(env: NodeJS.ProcessEnv = process.env) {
  return join(getDefaultStateDir(env), "pairing");
}

export function getDefaultActivityStorePath(env: NodeJS.ProcessEnv = process.env) {
  return join(getDefaultStateDir(env), "activity.json");
}

export function getDefaultRuntimeHealthPath(env: NodeJS.ProcessEnv = process.env) {
  return join(getDefaultStateDir(env), "runtime-health.json");
}

export function getDefaultRuntimePidPath(env: NodeJS.ProcessEnv = process.env) {
  return join(getDefaultStateDir(env), "clisbot.pid");
}

export function getDefaultRuntimeLogPath(env: NodeJS.ProcessEnv = process.env) {
  return join(getDefaultStateDir(env), "clisbot.log");
}

export function getDefaultRuntimeCredentialsPath(env: NodeJS.ProcessEnv = process.env) {
  return join(getDefaultStateDir(env), "runtime-credentials.json");
}

export function getDefaultWorkspaceTemplate(env: NodeJS.ProcessEnv = process.env) {
  return join(getDefaultWorkspaceRoot(env), "{agentId}");
}

export const APP_HOME_DIR = resolveAppHomeDir();
export const DEFAULT_CONFIG_PATH = getDefaultConfigPath();
export const DEFAULT_STATE_DIR = getDefaultStateDir();
export const DEFAULT_WORKSPACE_ROOT = getDefaultWorkspaceRoot();
export const DEFAULT_CREDENTIALS_DIR = getDefaultCredentialsDir();
export const DEFAULT_TMUX_SOCKET_PATH = getDefaultTmuxSocketPath();
export const DEFAULT_PROCESSED_EVENTS_PATH = getDefaultProcessedEventsPath();
export const DEFAULT_SESSION_STORE_PATH = getDefaultSessionStorePath();
export const DEFAULT_PAIRING_DIR = getDefaultPairingDir();
export const DEFAULT_ACTIVITY_STORE_PATH = getDefaultActivityStorePath();
export const DEFAULT_RUNTIME_HEALTH_PATH = getDefaultRuntimeHealthPath();
export const DEFAULT_RUNTIME_PID_PATH = getDefaultRuntimePidPath();
export const DEFAULT_RUNTIME_LOG_PATH = getDefaultRuntimeLogPath();
export const DEFAULT_RUNTIME_CREDENTIALS_PATH = getDefaultRuntimeCredentialsPath();

export function ensureParentDir(pathname: string) {
  return writeTextFile(pathname, "").catch(async () => {
    await ensureDirPath(dirname(pathname));
  });
}

export async function ensureDir(pathname: string) {
  await ensureDirPath(pathname);
}

export function applyTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replaceAll(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => values[key] ?? "");
}

export function sanitizeSessionName(raw: string): string {
  const cleaned = raw.replaceAll(/[^a-zA-Z0-9]+/g, "-").replaceAll(/-+/g, "-").replaceAll(
    /^-|-$/g,
    "",
  );
  return cleaned || "default";
}
