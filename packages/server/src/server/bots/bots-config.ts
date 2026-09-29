import path from "node:path";
import { expandTilde } from "../../utils/path.js";

/**
 * `daemon.bots` resolved at startup (docs/features/bots-and-chats/README.md, D3 and D10).
 * Read once like `agentSessionStorage`; a change needs a daemon restart in phase 1.
 */
export interface BotsConfig {
  enabled: boolean;
  /** Where `<root>/<slug>` bot homes go; never opened as a Project itself. */
  root: string;
}

export interface PersistedBotsConfig {
  enabled?: boolean;
  root?: string;
}

export const BOTS_ENABLED_ENV = "PASEO_BOTS_ENABLED";
const DEFAULT_ROOT_DIRECTORY = "workspaces";

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

/** Trim, expand `~`, absolute as is, relative under `paseoHome`; absent → `workspaces`. */
export function resolveBotsRoot(paseoHome: string, configuredRoot: string | undefined): string {
  const trimmed = configuredRoot?.trim();
  if (!trimmed) return path.join(paseoHome, DEFAULT_ROOT_DIRECTORY);
  const expanded = expandTilde(trimmed);
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(paseoHome, expanded);
}

export function resolveBotsConfig(input: {
  env: NodeJS.ProcessEnv;
  persisted: PersistedBotsConfig | undefined;
  paseoHome: string;
}): BotsConfig {
  return {
    // COMPAT(clisbot-bots-default): upstream Paseo has no Bots. The Clisbot fusion runs them
    // unless `daemon.bots.enabled: false` or `PASEO_BOTS_ENABLED=0` says otherwise; off stays
    // byte-for-byte upstream (README D10).
    enabled: parseBooleanEnv(input.env[BOTS_ENABLED_ENV]) ?? input.persisted?.enabled ?? true,
    root: resolveBotsRoot(input.paseoHome, input.persisted?.root),
  };
}

/** The config paths an environment override controls, for reload reporting. */
export function resolveBotsOverridePaths(env: NodeJS.ProcessEnv): string[] {
  return parseBooleanEnv(env[BOTS_ENABLED_ENV]) === undefined ? [] : ["daemon.bots.enabled"];
}
