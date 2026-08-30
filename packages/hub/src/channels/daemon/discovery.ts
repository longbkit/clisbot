import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Local daemon discovery for the embedded (loopback) Hub form, mirroring the
// stock client: read the daemon pid lock under the home, open its `listen` target
// over loopback WS. The team/remote form is reached via a relay-paired socket
// instead; this file is only the loopback leg.

export interface DaemonDiscoveryResult {
  url: string;
  source: "pid-file" | "default-port" | "env";
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 6767;
const PID_FILE_NAME = "paseo.pid";

/**
 * Resolve the local daemon WebSocket URL. Precedence: an explicit host (the
 * `CLISBOT_HOME`-adjacent operator override, or a configured target) > the pid
 * lock's `listen` field > the default `127.0.0.1:6767`. A pid lock that names a
 * unix socket path is reported as unsupported for the P0 loopback leg.
 */
export function discoverLocalDaemon(
  options: {
    home?: string | undefined;
    host?: string | undefined;
  } = {},
): DaemonDiscoveryResult {
  const explicit = options.host?.trim();
  if (explicit !== undefined && explicit !== "") {
    return { url: buildWsUrl(explicit), source: "env" };
  }
  const home = resolveHome(options.home);
  const listen = readPidLockListen(join(home, PID_FILE_NAME));
  if (listen !== undefined) {
    if (listen.startsWith("unix:") || listen.startsWith("sock:")) {
      throw new Error(
        `local daemon listens on a unix socket (${listen}); the P0 loopback leg requires a TCP listen target`,
      );
    }
    return { url: buildWsUrl(listen), source: "pid-file" };
  }
  return { url: buildWsUrl(`${DEFAULT_HOST}:${DEFAULT_PORT}`), source: "default-port" };
}

/**
 * The daemon/Hub shared home, by precedence: an explicit `home` (the operator
 * override) > `PASEO_HOME` (the env-alias sets it to the shared `~/.clisbot`
 * home, or the operator's `CLISBOT_HOME`) > the stock `~/.paseo`. Exported so
 * the channel plane's media home-root fallback (relay media posts) resolves
 * the home with the SAME precedence as daemon discovery — one home, one rule.
 */
export function resolveHome(
  home?: string,
  environment: Record<string, string | undefined> = process.env,
): string {
  const value = home?.trim() ?? environment["PASEO_HOME"]?.trim();
  if (value !== undefined && value !== "") return value.replace(/^~$/, homedir());
  // Fork path: the env-alias (src/env-alias.ts) sets PASEO_HOME to the shared
  // ~/.clisbot home at process entry, so this `~/.paseo` fallback is only live
  // on the stock upstream path. If that ordering ever changes, pass home in.
  return join(homedir(), ".paseo");
}

function readPidLockListen(path: string): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    const lock = JSON.parse(raw) as { listen?: unknown; sockPath?: unknown };
    const listen =
      typeof lock.listen === "string" && lock.listen.trim() !== "" ? lock.listen : undefined;
    if (listen !== undefined) return listen;
    if (typeof lock.sockPath === "string" && lock.sockPath.trim() !== "")
      return `unix:${lock.sockPath}`;
  } catch {
    return undefined;
  }
  return undefined;
}

function buildWsUrl(hostPort: string): string {
  const [host, port] = hostPort.split(":");
  if (port === undefined || port.trim() === "") {
    throw new Error(`invalid daemon listen target: ${hostPort}`);
  }
  return `ws://${host}:${port}/ws`;
}
