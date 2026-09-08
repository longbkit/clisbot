// upstream: src/channels/account-snapshot-fields.ts@5d8067a4483
// D-CORE-302: upstream's file is the redaction boundary between runtime account
// objects and public status snapshots, so it pulls `@openclaw/net-policy`'s URL
// redactors, `src/utils.ts` and the full `ChannelAccountSnapshot` type. Fusion's
// Hub owns account snapshots; only the credential-status inference the ported
// Discord `accounts.ts` reads is carried, with upstream's function bodies
// unchanged. The projection, redaction and snapshot-field helpers are omitted.
import { isRecord } from "../normalization-core/record-coerce.js";

const CREDENTIAL_STATUS_KEYS = [
  "tokenStatus",
  "botTokenStatus",
  "appTokenStatus",
  "signingSecretStatus",
  "userTokenStatus",
] as const;

export type CredentialStatusKey = (typeof CREDENTIAL_STATUS_KEYS)[number];

function readCredentialStatus(
  record: Record<string, unknown>,
  key: CredentialStatusKey | "apiCredentialStatus",
) {
  const value = record[key];
  return value === "available" || value === "configured_unavailable" || value === "missing"
    ? value
    : undefined;
}

/**
 * Infers whether any known credential status makes an account configured.
 *
 * Status commands need this metadata for "configured but unavailable" accounts without reading
 * raw credentials from runtime-only helpers.
 */
export function resolveConfiguredFromCredentialStatuses(account: unknown): boolean | undefined {
  const record = isRecord(account) ? account : null;
  if (!record) {
    return undefined;
  }
  let sawCredentialStatus = false;
  for (const key of CREDENTIAL_STATUS_KEYS) {
    const status = readCredentialStatus(record, key);
    if (!status) {
      continue;
    }
    sawCredentialStatus = true;
    if (status !== "missing") {
      return true;
    }
  }
  return sawCredentialStatus ? false : undefined;
}

/** Infers configured state only from the credential status keys required by a channel. */
export function resolveConfiguredFromRequiredCredentialStatuses(
  account: unknown,
  requiredKeys: CredentialStatusKey[],
): boolean | undefined {
  const record = isRecord(account) ? account : null;
  if (!record) {
    return undefined;
  }
  let sawCredentialStatus = false;
  for (const key of requiredKeys) {
    const status = readCredentialStatus(record, key);
    if (!status) {
      continue;
    }
    sawCredentialStatus = true;
    if (status === "missing") {
      return false;
    }
  }
  return sawCredentialStatus ? true : undefined;
}
