// COMPAT(clisbot-bot): channel credential input for `bot start` — the three
// kinds Clisbot's `parseTokenInput` uses (implementation doc §2.1): a literal
// value, a `${ENV_REF}`, or a secret-file path.
//
// Hub stores the resolved credential in an encrypted Connection envelope. No
// local mirror or backup is created by this command.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CommandError } from "../../output/index.js";

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
export function resolveTokenSecret(
  input: ParsedTokenInput,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (input.kind === "literal") return input.value;
  if (input.kind === "env") {
    const value = env[input.name];
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

function tokenInputError(message: string): CommandError {
  return { code: "CREDENTIAL_INPUT_INVALID", message };
}
