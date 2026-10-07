import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readHubStateFile } from "../hub/local-hub.js";
import { createLaunchd, type Launchd } from "./launchd.js";
import {
  autostartError,
  resolveAutostartContext,
  resolveAutostartTargets,
  type AutostartTarget,
} from "./targets.js";

export interface AutostartHost {
  targets: AutostartTarget[];
  launchd: Launchd;
}

export interface AutostartOptions {
  home?: unknown;
  labelPrefix?: unknown;
  listen?: unknown;
  hubPort?: unknown;
  target?: unknown;
  env?: unknown;
}

/** The host side of the command: process globals in one place, so the plan and
 * the launchd client stay injectable for tests. */
export function resolveHostAutostart(options: AutostartOptions): AutostartHost {
  const userHome = os.homedir();
  const context = resolveAutostartContext({
    options,
    platform: process.platform,
    userHome,
    nodePath: process.execPath,
    cliBinPath: resolveCliBinPath(import.meta.url),
    environment: process.env,
  });
  if (!existsSync(context.cliBinPath)) {
    throw autostartError(
      "CLI_BIN_MISSING",
      `CLI entry not found at ${context.cliBinPath}.`,
      "Build the CLI first so the agent runs the same binary you installed with.",
    );
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === null) {
    throw autostartError(
      "UNSUPPORTED_PLATFORM",
      "Autostart needs a POSIX user id for the launchd gui domain.",
    );
  }
  const hubPort = resolveHubPortOption(options.hubPort, context.home);
  return {
    targets: resolveAutostartTargets({ ...context, hubPort }),
    launchd: createLaunchd({ userHome, uid }),
  };
}

/** Mirror `hub start`'s own rule: an explicit port, else the port the home
 * already recorded, else the Hub's built-in default. */
function resolveHubPortOption(explicit: unknown, home: string): number | undefined {
  const given = typeof explicit === "string" && explicit.length > 0;
  const port = given ? Number(explicit) : readHubStateFile(home)?.port;
  if (port === undefined) return undefined;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw autostartError("INVALID_HUB_PORT", `Invalid --hub-port: ${String(explicit)}`);
  }
  return port;
}

/** dist/commands/autostart/host.js -> <cli package root>/bin/paseo */
export function resolveCliBinPath(moduleUrl: string): string {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(moduleUrl)), "..", "..", "..");
  return path.join(packageRoot, "bin", "paseo");
}
