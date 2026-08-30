// COMPAT(clisbot-bot): channel credential input for `bot start` — the three
// kinds Clisbot's `parseTokenInput` uses (implementation doc §2.1): a literal
// value, a `${ENV_REF}`, or a secret-file path.
//
// `channels add` mirrors the resolved secret verbatim into the Hub data dir
// (`secrets/<channel>--<account>`, no extension) and that mirror path is the
// `secretRef` the account file points at (the supervisor reads it on restart).
// So the mirror IS the runtime credential: it dies with `bot stop`. `--persist`
// additionally writes a durable 0600 copy at `secrets/<channel>-<account>.json`
// (single dash + `.json`, the operator-facing §4.3.3 shape) so a later plain
// `bot start`/`hub start` re-seeds the account without re-prompting.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { CommandError } from "../../output/index.js";

export const BOT_SECRETS_DIRNAME = "secrets";

export type ParsedTokenInput =
  | { kind: "literal"; value: string }
  | { kind: "env"; name: string }
  | { kind: "file"; path: string };

const ENV_REF_PATTERN = /^\$\{([A-Z_][A-Z0-9_]*)\}$/;

/**
 * Classify a credential value. A `${ENV_REF}` reads the named variable; a value
 * that names an existing file on disk is a secret-file path; anything else is a
 * literal token. The existence check is the discriminator: a channel token never
 * happens to be a path to a file, so a misspelled path errors clearly instead of
 * being used as a literal token.
 */
export function parseTokenInput(raw: string): ParsedTokenInput {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw tokenInputError("channel credential is empty");
  const envRef = ENV_REF_PATTERN.exec(trimmed);
  if (envRef !== null) return { kind: "env", name: envRef[1] };
  const candidate = path.resolve(expandHome(trimmed));
  if (trimmed.includes("/") || trimmed.startsWith("~")) {
    if (existsSync(candidate)) return { kind: "file", path: candidate };
    throw tokenInputError(`credential file ${candidate} does not exist`);
  }
  return { kind: "literal", value: trimmed };
}

function expandHome(raw: string): string {
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  if (raw === "~") return home;
  if (raw.startsWith("~/")) return path.join(home, raw.slice(2));
  return raw;
}

/** Resolve a parsed credential to its secret string (literal or env var). */
export function resolveTokenSecret(input: ParsedTokenInput): string {
  if (input.kind === "literal") return input.value;
  if (input.kind === "env") {
    const value = process.env[input.name];
    if (value === undefined || value.trim().length === 0) {
      throw tokenInputError(`environment variable \${${input.name}} is not set`);
    }
    return value.trim();
  }
  return readCredentialFile(input.path);
}

export function readCredentialFile(filePath: string): string {
  let value: string;
  try {
    value = readFileSync(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw tokenInputError(`cannot read credential file ${filePath}: ${message}`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) throw tokenInputError(`credential file ${filePath} is empty`);
  return trimmed;
}

/**
 * The durable `--persist`-ed secret file: `<home>/secrets/<channel>-<account>.json`
 * (single dash + `.json`). This is the operator-facing `secretRef` shape from the
 * implementation doc §4.3.3 (`slack-work.json`, `telegram-bot-token.json`), and it
 * must not collide with the Hub's own runtime mirror (see `hubSecretMirrorPath`).
 */
export function tokenSecretPath(home: string, channel: string, account: string): string {
  return path.join(home, BOT_SECRETS_DIRNAME, `${channel}-${account}.json`);
}

/**
 * The runtime-only secret the Hub mirrors at `channels add` time:
 * `<dataDir>/secrets/<channel>--<account>` (double dash, no extension). This is
 * the `secretRef` the account file actually points at and the path the supervisor
 * reads on restart. It dies with a `bot stop` when the account was not `--persist`-ed.
 * The data dir is the Hub data dir, which for the embedded form defaults to the
 * shared Clisbot home (implementation doc §4.5, `env-alias.ts`).
 */
export function hubSecretMirrorPath(dataDir: string, channel: string, account: string): string {
  return path.join(dataDir, BOT_SECRETS_DIRNAME, `${channel}--${account}`);
}

/**
 * Resolve the Hub data dir the way the embedded Hub does (`packages/hub/src/
 * data-directory.ts` `resolveHubDataDirectory`): an explicit override
 * (`CLISBOT_HUB_DATA_DIR`/`PASEO_HUB_DATA_DIR`) wins, then an absolute
 * `XDG_DATA_HOME`, then the shared home. Kept here (additive, CLI-owned) so
 * `bot stop` can find the mirror files without importing the Hub package.
 */
export function resolveHubDataDir(home: string, env: NodeJS.ProcessEnv): string {
  const override = env["CLISBOT_HUB_DATA_DIR"] ?? env["PASEO_HUB_DATA_DIR"];
  if (override !== undefined && override.trim() !== "") return path.resolve(override);
  const xdg = env["XDG_DATA_HOME"];
  if (xdg !== undefined && xdg.trim() !== "" && path.isAbsolute(xdg)) {
    return path.join(xdg, "paseo-hub");
  }
  return home;
}

/**
 * Persist a channel credential to a 0600 file under the home's `secrets/` dir.
 * Slack carries `{botToken, appToken}`; Telegram carries `{botToken}`. The
 * returned path is the `secretRef` the account file (and manifest) records.
 */
export function persistBotCredential(
  home: string,
  channel: "slack" | "telegram",
  account: string,
  secret: BotChannelSecret,
): string {
  const target = tokenSecretPath(home, channel, account);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const payload =
    channel === "slack"
      ? {
          botToken: secret.botToken ?? "",
          ...(secret.appToken !== undefined ? { appToken: secret.appToken } : {}),
        }
      : { botToken: secret.token ?? "" };
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, target);
    chmodSync(target, 0o600);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
  return target;
}

export interface BotChannelSecret {
  botToken?: string;
  appToken?: string;
  token?: string;
}

function tokenInputError(message: string): CommandError {
  return { code: "CREDENTIAL_INPUT_INVALID", message };
}
