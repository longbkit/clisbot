import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ensureDir as ensureDirPath, writeTextFile } from "./fs.ts";

export const APP_HOME_DIR = join(homedir(), ".muxbot");
export const DEFAULT_CONFIG_PATH = join(APP_HOME_DIR, "muxbot.json");
export const DEFAULT_STATE_DIR = join(APP_HOME_DIR, "state");
export const DEFAULT_WORKSPACE_ROOT = join(APP_HOME_DIR, "workspaces");
export const DEFAULT_TMUX_SOCKET_PATH = join(DEFAULT_STATE_DIR, "muxbot.sock");
export const DEFAULT_PROCESSED_EVENTS_PATH = join(DEFAULT_STATE_DIR, "processed-slack-events.json");
export const DEFAULT_SESSION_STORE_PATH = join(DEFAULT_STATE_DIR, "sessions.json");
export const DEFAULT_PAIRING_DIR = join(DEFAULT_STATE_DIR, "pairing");
export const DEFAULT_ACTIVITY_STORE_PATH = join(DEFAULT_STATE_DIR, "activity.json");
export const DEFAULT_RUNTIME_HEALTH_PATH = join(DEFAULT_STATE_DIR, "runtime-health.json");
export const DEFAULT_RUNTIME_PID_PATH = join(DEFAULT_STATE_DIR, "muxbot.pid");
export const DEFAULT_RUNTIME_LOG_PATH = join(DEFAULT_STATE_DIR, "muxbot.log");

export function expandHomePath(rawPath: string): string {
  if (rawPath === "~") {
    return homedir();
  }
  if (rawPath.startsWith("~/")) {
    return join(homedir(), rawPath.slice(2));
  }
  return rawPath;
}

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
