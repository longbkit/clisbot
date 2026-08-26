import { homedir } from "node:os";
import { join } from "node:path";

// COMPAT(clisbot-env-alias): fork-owned operator namespace + shared home. Applied at
// process entry (the `clisbot` CLI at every spawn, and the Hub's own entry for the
// deployed form, per implementation doc §4.5 / plan §14.8). The internal code keeps
// reading upstream `PASEO_*` names, so an explicit `PASEO_*` always wins and an
// unmodified upstream read is never re-fought on a `getpaseo/hub` merge.

/**
 * The `CLISBOT_*` → internal-name table. Each row copies the operator variable into
 * its internal target only when the target is unset; a value set explicitly on the
 * internal name always wins. This is the "alias at the boundary, not a rename in
 * place" decision (implementation doc §4.5).
 */
const CLISBOT_ALIAS_TABLE = [
  ["CLISBOT_HOME", "PASEO_HOME"],
  ["CLISBOT_HUB_DATA_DIR", "PASEO_HUB_DATA_DIR"],
  ["CLISBOT_HUB_DATABASE_URL", "DATABASE_URL"],
  ["CLISBOT_HUB_CHANNELS_ENABLED", "PASEO_HUB_CHANNELS_ENABLED"],
  ["CLISBOT_HUB_BIND", "PASEO_HUB_BIND"],
  ["CLISBOT_HUB_URL", "PASEO_HUB_URL"],
  ["CLISBOT_HUB_API_KEY", "PASEO_HUB_API_KEY"],
] as const;

const FORK_DEFAULT_BIND = "127.0.0.1";
const FORK_DEFAULT_HOME_DIRECTORY_NAME = ".clisbot";
// The channel control plane is on by default in the embedded form; the
// supervisor turns it off with an explicit CLISBOT_HUB_CHANNELS_ENABLED=0.
const FORK_DEFAULT_CHANNELS_ENABLED = "1";

type EnvLike = Record<string, string | undefined>;

function isSet(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

/**
 * The shared machine home: the daemon (`CLISBOT_HOME`/`PASEO_HOME`) and the Hub
 * (`CLISBOT_HUB_DATA_DIR`/`PASEO_HUB_DATA_DIR`) both default to `~/.clisbot` — one
 * directory, two writers, no top-level entry overlap (implementation doc §4.5).
 */
function resolveSharedHome(environment: EnvLike): string {
  return isSet(environment["PASEO_HOME"])
    ? (environment["PASEO_HOME"] as string)
    : join(homedir(), FORK_DEFAULT_HOME_DIRECTORY_NAME);
}

/**
 * Apply the Clisbot environment defaults to `environment` (in place, defaulting to
 * `process.env`): (1) alias every set `CLISBOT_X` into its internal target when the
 * target is unset, and (2) fill the fork defaults — loopback bind, the shared home
 * (daemon home + Hub data dir), and the default-on channel switch — when unset.
 * Idempotent. The listen port is NOT set here; it is a CLI-own default passed to
 * the spawned Hub (`hub start`), keeping the Hub source mergeable with
 * `getpaseo/hub`.
 */
export function applyClisbotEnvDefaults(environment: EnvLike = process.env): void {
  for (const [clisbotKey, internalKey] of CLISBOT_ALIAS_TABLE) {
    const operatorValue = environment[clisbotKey];
    if (!isSet(operatorValue)) continue;
    if (isSet(environment[internalKey])) continue;
    environment[internalKey] = operatorValue;
  }
  if (!isSet(environment["PASEO_HUB_BIND"])) {
    environment["PASEO_HUB_BIND"] = FORK_DEFAULT_BIND;
  }
  if (!isSet(environment["PASEO_HOME"])) {
    environment["PASEO_HOME"] = resolveSharedHome(environment);
  }
  if (!isSet(environment["PASEO_HUB_DATA_DIR"])) {
    environment["PASEO_HUB_DATA_DIR"] = resolveSharedHome(environment);
  }
  if (!isSet(environment["PASEO_HUB_CHANNELS_ENABLED"])) {
    environment["PASEO_HUB_CHANNELS_ENABLED"] = FORK_DEFAULT_CHANNELS_ENABLED;
  }
}
