// The credential keys of an account's vertical-owned `config` block, and the
// two operations the Connection Admin surface needs over them: hide them on
// read, keep the stored values on save (docs/features/access/scoped-admins.md:
// a Connection Admin never sees the bot token or a secret).
//
// A typed channel declares its credential keys in its schema with
// `.meta(SECRET)` (`schema.ts`). The other channels pass `config` through
// verbatim, so an upstream credential authored there (`botToken`,
// `signingSecret`, …) is recognized by name; the same name rule applies at every
// nesting level.

import { z } from "zod";
import { ACCOUNT_CONFIG_SCHEMAS } from "./compile-support.js";

type ConfigRecord = Record<string, unknown>;

const CREDENTIAL_NAME =
  /(token|secret|password|apikey|privatekey|encryptkey|serviceaccount|credentials?)$/iu;

/** The keys a channel's schema marks as secret. */
function declaredSecretKeys(channel: string): ReadonlySet<string> {
  const schema = ACCOUNT_CONFIG_SCHEMAS[channel];
  if (!(schema instanceof z.ZodObject)) return new Set();
  const shape = schema.shape as Record<string, z.ZodType>;
  return new Set(
    Object.entries(shape)
      .filter(([, field]) => field.meta()?.["secret"] === true)
      .map(([key]) => key),
  );
}

/** A declared key counts only at the top of `config`; the name rule, at any depth. */
function isSecretKey(declared: ReadonlySet<string>, key: string, top: boolean): boolean {
  return (top && declared.has(key)) || CREDENTIAL_NAME.test(key);
}

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `config` without any credential, at any depth. */
export function redactAccountConfig(channel: string, config: ConfigRecord): ConfigRecord {
  const declared = declaredSecretKeys(channel);
  const redact = (value: ConfigRecord, top: boolean): ConfigRecord =>
    Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !isSecretKey(declared, key, top))
        .map(([key, item]) => [key, isRecord(item) ? redact(item, false) : item]),
    );
  return redact(config, true);
}

/**
 * `next` with every stored credential it leaves out put back, at any depth. A
 * credential `next` states itself wins: only the organization capability may
 * send one (the Route Admin save keeps the stored `config` whole).
 */
export function restoreAccountConfigSecrets(
  channel: string,
  stored: ConfigRecord,
  next: ConfigRecord,
): ConfigRecord {
  const declared = declaredSecretKeys(channel);
  const restore = (from: ConfigRecord, into: ConfigRecord, top: boolean): ConfigRecord => {
    const merged: ConfigRecord = { ...into };
    for (const [key, value] of Object.entries(from)) {
      if (isSecretKey(declared, key, top) && !Object.hasOwn(into, key)) merged[key] = value;
      else if (isRecord(value) && isRecord(into[key])) {
        merged[key] = restore(value, into[key] as ConfigRecord, false);
      }
    }
    return merged;
  };
  return restore(stored, next, true);
}
