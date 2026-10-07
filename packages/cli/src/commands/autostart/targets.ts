// COMPAT(clisbot-autostart): macOS login autostart for the fork's two
// long-running local processes. Upstream Paseo has no equivalent verb; nothing
// happens unless an operator runs `paseo autostart install`.

import path from "node:path";
import type { CommandError } from "../../output/index.js";

export type AutostartTargetName = "daemon" | "hub";

export const AUTOSTART_TARGET_NAMES: readonly AutostartTargetName[] = ["daemon", "hub"];

/** One launchd job: what to run for a target, and where its output goes. */
export interface AutostartTarget {
  name: AutostartTargetName;
  label: string;
  argv: string[];
  environment: Record<string, string>;
  workingDirectory: string;
  standardOutPath: string;
  standardErrorPath: string;
}

/** Everything a target is derived from, with no process globals inside. */
export interface AutostartContext {
  platform: NodeJS.Platform;
  userHome: string;
  home: string;
  labelPrefix: string;
  listen?: string;
  hubPort?: number;
  targets: readonly AutostartTargetName[];
  nodePath: string;
  cliBinPath: string;
  pathValue: string;
  env: Record<string, string>;
}

export const DEFAULT_LABEL_PREFIX = "sh.paseo";

const LAUNCHD_SEARCH_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const LABEL_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function autostartError(code: string, message: string, details?: unknown): CommandError {
  return details === undefined ? { code, message } : { code, message, details };
}

/** Commander's repeatable-option collector. */
export function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function parseTargetNames(raw: unknown): readonly AutostartTargetName[] {
  const values = Array.isArray(raw) ? raw : [];
  const names: AutostartTargetName[] = [];
  for (const value of values) {
    if (
      typeof value !== "string" ||
      !AUTOSTART_TARGET_NAMES.includes(value as AutostartTargetName)
    ) {
      throw autostartError(
        "INVALID_TARGET",
        `Unknown autostart target: ${String(value)}`,
        `Supported targets: ${AUTOSTART_TARGET_NAMES.join(", ")}`,
      );
    }
    const name = value as AutostartTargetName;
    if (!names.includes(name)) names.push(name);
  }
  return names.length > 0 ? names : AUTOSTART_TARGET_NAMES;
}

export function parseEnvOptions(raw: unknown): Record<string, string> {
  const values = Array.isArray(raw) ? raw : [];
  const env: Record<string, string> = {};
  for (const value of values) {
    const separator = typeof value === "string" ? value.indexOf("=") : -1;
    if (separator <= 0) {
      throw autostartError("INVALID_ENV", `Invalid --env value: ${String(value)}`, "Use KEY=VALUE");
    }
    const name = value.slice(0, separator);
    if (!ENV_NAME_PATTERN.test(name))
      throw autostartError("INVALID_ENV", `Invalid --env name: ${name}`);
    env[name] = value.slice(separator + 1);
  }
  return env;
}

export function resolveAutostartContext(input: {
  options: {
    home?: unknown;
    labelPrefix?: unknown;
    listen?: unknown;
    target?: unknown;
    env?: unknown;
  };
  platform: NodeJS.Platform;
  userHome: string;
  nodePath: string;
  cliBinPath: string;
  hubPort?: number;
  environment: NodeJS.ProcessEnv;
}): AutostartContext {
  const { options, environment } = input;
  const labelPrefix =
    typeof options.labelPrefix === "string" && options.labelPrefix.length > 0
      ? options.labelPrefix
      : DEFAULT_LABEL_PREFIX;
  if (!LABEL_PREFIX_PATTERN.test(labelPrefix)) {
    throw autostartError(
      "INVALID_LABEL_PREFIX",
      `Invalid --label-prefix: ${labelPrefix}`,
      "Use a reverse-DNS prefix such as sh.paseo or ai.clisbot.fusion",
    );
  }
  const configuredHome =
    environment.PASEO_HOME ?? environment.CLISBOT_HOME ?? path.join(input.userHome, ".paseo");
  return {
    platform: input.platform,
    userHome: input.userHome,
    home:
      typeof options.home === "string" && options.home.length > 0
        ? path.resolve(options.home)
        : path.resolve(configuredHome),
    labelPrefix,
    listen:
      typeof options.listen === "string" && options.listen.length > 0 ? options.listen : undefined,
    hubPort: input.hubPort,
    targets: parseTargetNames(options.target),
    nodePath: input.nodePath,
    cliBinPath: input.cliBinPath,
    pathValue: environment.PATH ?? "",
    env: parseEnvOptions(options.env),
  };
}

export function resolveAutostartTargets(context: AutostartContext): AutostartTarget[] {
  if (context.platform !== "darwin") {
    throw autostartError(
      "UNSUPPORTED_PLATFORM",
      `Autostart is implemented for macOS (launchd) only; this host is ${context.platform}.`,
    );
  }
  return context.targets.map((name) => buildTarget(name, context));
}

function buildTarget(name: AutostartTargetName, context: AutostartContext): AutostartTarget {
  const logDirectory = path.join(context.home, "state", "launchd");
  return {
    name,
    label: `${context.labelPrefix}.${name}`,
    argv: [context.nodePath, context.cliBinPath, ...autostartArguments(name, context)],
    environment: {
      HOME: context.userHome,
      PATH: launchdSearchPath(context),
      PASEO_HOME: context.home,
      CLISBOT_HOME: context.home,
      ...(context.listen === undefined ? {} : { PASEO_LISTEN: context.listen }),
      ...context.env,
    },
    workingDirectory: context.home,
    standardOutPath: path.join(logDirectory, `${name}.out.log`),
    standardErrorPath: path.join(logDirectory, `${name}.err.log`),
  };
}

/** The Hub's own default port is not the port an existing stack was installed
 * on, and the front door proxies the recorded one, so pin it when known. */
function autostartArguments(name: AutostartTargetName, context: AutostartContext): string[] {
  if (name === "daemon") return ["daemon", "start", "--foreground"];
  return context.hubPort === undefined
    ? ["hub", "start", "--foreground"]
    : ["hub", "start", "--foreground", "--port", String(context.hubPort)];
}

/** launchd hands a job `/usr/bin:/bin:/usr/sbin:/sbin`. The daemon spawns
 * provider binaries out of the user's PATH, so carry the installing one. */
function launchdSearchPath(context: AutostartContext): string {
  const seen: Record<string, true> = {};
  const entries: string[] = [];
  for (const entry of [
    path.dirname(context.nodePath),
    ...context.pathValue.split(":"),
    ...LAUNCHD_SEARCH_PATH.split(":"),
  ]) {
    if (entry.length === 0 || seen[entry] === true) continue;
    seen[entry] = true;
    entries.push(entry);
  }
  return entries.join(":");
}
