import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

// COMPAT(clisbot-env-alias): fork-owned operator namespace + shared home. Applied at
// process entry (the `clisbot` CLI at every spawn, and the Hub's own entry for the
// deployed form, per implementation doc §4.5 / plan §14.8). The internal code keeps
// reading upstream `CLISBOT_*` names, so an explicit `CLISBOT_*` always wins and an
// unmodified upstream read is never re-fought on a `getpaseo/hub` merge.

/**
 * The `CLISBOT_*` → internal-name table. Each row copies the operator variable into
 * its internal target only when the target is unset; a value set explicitly on the
 * internal name always wins. This is the "alias at the boundary, not a rename in
 * place" decision (implementation doc §4.5).
 */
const CLISBOT_ALIAS_TABLE = [
  ["CLISBOT_HUB_DATABASE_URL", "DATABASE_URL"],
  ["CLISBOT_RESEND_API_KEY", "RESEND_API_KEY"],
  ["CLISBOT_RESEND_FROM", "RESEND_FROM"],
] as const;

const FORK_DEFAULT_BIND = "127.0.0.1";
const FORK_DEFAULT_HOME_DIRECTORY_NAME = ".clisbot";
const FORK_DEFAULT_HUB_DATA_DIRECTORY_NAME = "hub";
// The channel control plane is on by default in the embedded form; the
// supervisor turns it off with an explicit CLISBOT_HUB_CHANNELS_ENABLED=0.
const FORK_DEFAULT_CHANNELS_ENABLED = "1";

type EnvLike = Record<string, string | undefined>;

function isSet(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

/**
 * The shared machine home. Daemon state lives directly here; new Hub state lives
 * below its `hub/` child so PGlite's PostgreSQL files do not flood the machine-home
 * root.
 */
function resolveSharedHome(environment: EnvLike): string {
  return isSet(environment["CLISBOT_HOME"])
    ? (environment["CLISBOT_HOME"] as string)
    : join(homedir(), FORK_DEFAULT_HOME_DIRECTORY_NAME);
}

/**
 * Keep an existing pre-nested PGlite home working until the operator migrates it.
 * `PG_VERSION` is the database-owned marker: daemon-only homes never create it.
 * Once `<home>/hub/PG_VERSION` exists, the nested layout is authoritative even if
 * a stale legacy marker was left behind.
 */
function resolveDefaultHubDataDirectory(environment: EnvLike): string {
  const sharedHome = resolveSharedHome(environment);
  const nested = join(sharedHome, FORK_DEFAULT_HUB_DATA_DIRECTORY_NAME);
  if (existsSync(join(nested, "PG_VERSION"))) return nested;
  if (existsSync(join(sharedHome, "PG_VERSION"))) return sharedHome;
  return nested;
}

/**
 * Copy every set `CLISBOT_X` into its internal target when the target is unset. The Vite dev
 * server enters through `start-server.ts`, not `main()`, and needs the operator names without
 * the process-entry defaults below (the dev runner owns home, data dir, and bind).
 */
export function applyClisbotEnvAliases(environment: EnvLike = process.env): void {
  for (const [clisbotKey, internalKey] of CLISBOT_ALIAS_TABLE) {
    const operatorValue = environment[clisbotKey];
    if (!isSet(operatorValue)) continue;
    if (isSet(environment[internalKey])) continue;
    environment[internalKey] = operatorValue;
  }
}

/**
 * Apply the Clisbot environment defaults to `environment` (in place, defaulting to
 * `process.env`): (1) alias every set `CLISBOT_X` into its internal target when the
 * target is unset, and (2) fill the fork defaults — loopback bind, daemon home,
 * nested Hub data dir, and the default-on channel switch — when unset.
 * Idempotent. The listen port is NOT set here; it is a CLI-own default passed to
 * the spawned Hub (`hub start`), keeping the Hub source mergeable with
 * `getpaseo/hub`.
 */
export function applyClisbotEnvDefaults(environment: EnvLike = process.env): void {
  applyClisbotEnvAliases(environment);
  if (!isSet(environment["CLISBOT_HUB_BIND"])) {
    environment["CLISBOT_HUB_BIND"] = FORK_DEFAULT_BIND;
  }
  if (!isSet(environment["CLISBOT_HOME"])) {
    environment["CLISBOT_HOME"] = resolveSharedHome(environment);
  }
  if (!isSet(environment["CLISBOT_HUB_DATA_DIR"])) {
    environment["CLISBOT_HUB_DATA_DIR"] = resolveDefaultHubDataDirectory(environment);
  }
  if (!isSet(environment["CLISBOT_HUB_CHANNELS_ENABLED"])) {
    environment["CLISBOT_HUB_CHANNELS_ENABLED"] = FORK_DEFAULT_CHANNELS_ENABLED;
  }
}
