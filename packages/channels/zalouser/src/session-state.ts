// upstream: extensions/zalouser/src/session-state.ts@5d8067a4483
// D-ZU-004: upstream opens OpenClaw's SQLite-backed plugin state through the
// global plugin runtime store (`getZalouserRuntime().state.openSyncKeyedStore`).
// Fusion injects a `ZalouserSessionStore` instead (`fusion/session-store.ts`);
// `openZalouserCredentialsStore` is the ONLY body that changes, and it returns
// the same synchronous `lookup`/`register`/`update` surface, so every function
// below keeps upstream's shape and flow.
//
// D-ZU-005: `resolveLegacyZalouserCredentialsDir` / `…Path` are dropped. They
// resolve OpenClaw's own state directory so `doctor` can migrate a pre-plugin-
// state credentials file; Fusion has no OpenClaw state dir and no such file to
// migrate.
import { createHash } from "node:crypto";
import { normalizeLowercaseStringOrEmpty } from "@getpaseo/channels-core/plugin-sdk/string-coerce-runtime";
import {
  getZalouserSessionCache,
  ZALOUSER_SESSION_MAX_ENTRIES,
  ZALOUSER_SESSION_NAMESPACE,
  type ZalouserSessionCache,
} from "./fusion/session-store.js";
import type { Credentials } from "./zca-client.js";

export type StoredZaloCredentials = {
  profile: string;
  imei: string;
  cookie: Credentials["cookie"];
  userAgent: string;
  language?: string;
  createdAt: string;
  lastUsedAt?: string;
};

type ZaloCredentialRevocationRecord = {
  kind: "revoked";
  profile: string;
  revokedAt: string;
};

export type ZaloCredentialStateRecord = StoredZaloCredentials | ZaloCredentialRevocationRecord;

export const ZALOUSER_CREDENTIALS_NAMESPACE = ZALOUSER_SESSION_NAMESPACE;
export const ZALOUSER_CREDENTIALS_MAX_ENTRIES = ZALOUSER_SESSION_MAX_ENTRIES;

export function normalizeZalouserCredentialProfile(profile?: string | null): string {
  return normalizeLowercaseStringOrEmpty(profile) || "default";
}

export function zalouserCredentialStoreKey(profile?: string | null): string {
  return `profile:${createHash("sha256")
    .update(normalizeZalouserCredentialProfile(profile))
    .digest("hex")}`;
}

export function normalizeStoredZaloCredentials(
  value: unknown,
  profile?: string | null,
): StoredZaloCredentials | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const parsed = value as Partial<StoredZaloCredentials>;
  if (
    typeof parsed.imei !== "string" ||
    !parsed.imei ||
    !parsed.cookie ||
    typeof parsed.userAgent !== "string" ||
    !parsed.userAgent ||
    typeof parsed.createdAt !== "string" ||
    !parsed.createdAt
  ) {
    return null;
  }
  return {
    profile: normalizeZalouserCredentialProfile(profile ?? parsed.profile),
    imei: parsed.imei,
    cookie: parsed.cookie,
    userAgent: parsed.userAgent,
    ...(typeof parsed.language === "string" ? { language: parsed.language } : {}),
    createdAt: parsed.createdAt,
    ...(typeof parsed.lastUsedAt === "string" ? { lastUsedAt: parsed.lastUsedAt } : {}),
  };
}

export function isZaloCredentialRevocation(
  value: unknown,
  profile?: string | null,
): value is ZaloCredentialRevocationRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const parsed = value as Partial<ZaloCredentialRevocationRecord>;
  return (
    parsed.kind === "revoked" &&
    typeof parsed.revokedAt === "string" &&
    parsed.revokedAt.length > 0 &&
    normalizeZalouserCredentialProfile(parsed.profile) ===
      normalizeZalouserCredentialProfile(profile ?? parsed.profile)
  );
}

function openZalouserCredentialsStore(
  _env: NodeJS.ProcessEnv = process.env,
): ZalouserSessionCache {
  return getZalouserSessionCache();
}

export function loadStoredZaloCredentials(
  profile: string,
  env: NodeJS.ProcessEnv = process.env,
): StoredZaloCredentials | null {
  const normalizedProfile = normalizeZalouserCredentialProfile(profile);
  const stored = openZalouserCredentialsStore(env).lookup(
    zalouserCredentialStoreKey(normalizedProfile),
  );
  const parsed = normalizeStoredZaloCredentials(stored, normalizedProfile);
  return parsed?.profile === normalizedProfile ? parsed : null;
}

export function saveStoredZaloCredentials(
  profile: string,
  credentials: Omit<StoredZaloCredentials, "profile">,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const normalizedProfile = normalizeZalouserCredentialProfile(profile);
  openZalouserCredentialsStore(env).register(zalouserCredentialStoreKey(normalizedProfile), {
    profile: normalizedProfile,
    ...credentials,
  });
}

export function refreshStoredZaloCredentials(
  profile: string,
  credentials: Omit<StoredZaloCredentials, "profile">,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const normalizedProfile = normalizeZalouserCredentialProfile(profile);
  const store = openZalouserCredentialsStore(env);
  const update = store.update;
  if (!update) {
    throw new Error("Zalo credential refresh requires atomic plugin-state updates");
  }
  let saved = true;
  update(zalouserCredentialStoreKey(normalizedProfile), (current) => {
    // Background refreshes can finish after logout. Preserve the revocation;
    // only an explicit QR login may replace it with a new authenticated session.
    if (isZaloCredentialRevocation(current, normalizedProfile)) {
      saved = false;
      return current;
    }
    return { profile: normalizedProfile, ...credentials };
  });
  return saved;
}

export function clearStoredZaloCredentials(
  profile: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const normalizedProfile = normalizeZalouserCredentialProfile(profile);
  const store = openZalouserCredentialsStore(env);
  const hadCredentials =
    normalizeStoredZaloCredentials(
      store.lookup(zalouserCredentialStoreKey(normalizedProfile)),
      normalizedProfile,
    ) !== null;
  // Keep a durable revocation marker so doctor cannot resurrect explicitly
  // cleared credentials from an older profile file.
  store.register(zalouserCredentialStoreKey(normalizedProfile), {
    kind: "revoked",
    profile: normalizedProfile,
    revokedAt: new Date().toISOString(),
  });
  return hadCredentials;
}
