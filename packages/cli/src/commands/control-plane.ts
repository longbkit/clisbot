// COMPAT(clisbot-control-plane): shared target resolution for the channels/users
// verbs — local hub-local.json discovery, or an explicit --hub remote origin
// (implementation doc §3.2, §4.5).

import type { Command } from "commander";
import type { CommandError, CommandOptions } from "../output/index.js";
import { HubCommandError } from "./hub/error.js";
import { normalizeHubOrigin } from "./hub/origin.js";
import { resolveLocalHubState } from "./hub/local-hub.js";

export interface ControlPlaneTarget {
  origin: string;
  apiKey?: string;
  source: "local" | "remote";
}

export interface ControlPlaneOptions {
  hub?: string;
  home?: string;
  apiKey?: string;
}

const CONTROL_PLANE_ABSENT_MESSAGE =
  "The Hub does not expose the channel control plane (/api/v1/channels and /api/v1/users are absent). " +
  "The running Hub is not the fork's embedded Hub, or it predates the control-plane routes.";

function optionString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Commander stores kebab-case flags under camelCase keys (`--secret-file`
 * lands as `options.secretFile`). Accept the flag name and find the key.
 */
function flagKey(options: CommandOptions, flag: string): string | undefined {
  if (options[flag] !== undefined) return flag;
  const camel = flag.replace(/-([a-z])/g, (_match, c: string) => c.toUpperCase());
  if (options[camel] !== undefined) return camel;
  return undefined;
}

export function resolveControlPlaneTarget(
  options: ControlPlaneOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): ControlPlaneTarget {
  const hub = optionString(options.hub);
  if (hub !== undefined) {
    return { origin: normalizeHubOrigin(hub), apiKey: options.apiKey, source: "remote" };
  }
  const local = resolveLocalHubState({ home: options.home }, env);
  if (local.state !== null && local.running) {
    // The embedded control plane trusts loopback; no API key is sent.
    return { origin: local.state.url, source: "local" };
  }
  if (local.staleStateFile && local.state !== null) {
    throw new HubCommandError(
      "HUB_NOT_RUNNING",
      `The local Hub state file at ${local.statePath} records PID ${local.state.pid}, ` +
        "but that process is not running. Start the Hub with `clisbot hub start`.",
    );
  }
  throw new HubCommandError(
    "HUB_NOT_RUNNING",
    "No local Hub is running. Start the embedded Hub with `clisbot hub start`, " +
      "or point the verb at a running Hub with --hub <origin>.",
  );
}

/**
 * True when a HubCommandError is the 404 a Hub without the control-plane routes
 * returns. The transport reports a 404 two ways: a conforming problem+json body
 * yields code HUB_NOT_FOUND, any other body yields HUB_REQUEST_FAILED with
 * "… with HTTP 404." (see hub/hub-client/internal/problem.ts). Both mean the
 * same thing here: the routes do not exist on this Hub.
 */
export function isControlPlaneAbsent(error: unknown): boolean {
  if (!(error instanceof HubCommandError)) return false;
  const plain404 = error.code === "HUB_REQUEST_FAILED" && error.message.endsWith("with HTTP 404.");
  return error.code === "HUB_NOT_FOUND" || plain404;
}

/**
 * Run a control-plane request, translating the absent-routes 404 into an
 * operator-facing message. Every other failure propagates unchanged.
 */
export function controlPlaneRequest<T>(request: () => Promise<T>): Promise<T> {
  return request().catch((error: unknown) => {
    if (isControlPlaneAbsent(error)) {
      throw new HubCommandError("HUB_NOT_FOUND", CONTROL_PLANE_ABSENT_MESSAGE);
    }
    throw error;
  });
}

/**
 * Commander types option values as unknown; only non-empty strings are
 * meaningful target options.
 */
export function extractControlPlaneOptions(options: CommandOptions): ControlPlaneOptions {
  return {
    hub: optionString(options.hub),
    home: optionString(options.home),
    apiKey: optionString(options.apiKey),
  };
}

/** Non-empty string option value; undefined when absent or blank. */
export function stringOption(options: CommandOptions, name: string): string | undefined {
  const key = flagKey(options, name);
  return key === undefined ? undefined : optionString(options[key]);
}

/** Non-empty string option value; throws when absent or blank. */
export function requiredStringOption(options: CommandOptions, name: string): string {
  const key = flagKey(options, name);
  const value = key === undefined ? undefined : optionString(options[key]);
  if (value === undefined) {
    const error: CommandError = {
      code: "MISSING_OPTION",
      message: `--${name} requires a non-empty value`,
    };
    throw error;
  }
  return value;
}

/** The target-resolution flags shared by every channels/users verb. */
export function addControlPlaneTargetOptions(command: Command): Command {
  return command
    .option("--hub <origin>", "Hub origin to target (default: the local Hub from hub-local.json)")
    .option("--home <path>", "Clisbot home directory (default: $CLISBOT_HOME or ~/.clisbot)")
    .option("--api-key <secret>", "Hub API key for a remote --hub origin");
}
