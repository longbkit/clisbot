// COMPAT(clisbot-channels): the Google Chat Connection — validate the
// service-account document, mint one access token from it, then store the
// document (or the path to it) in the Hub's encrypted `googlechat_connections`
// owner.
//
// There is no token to paste and no OAuth dance here: the credential IS the
// service-account JSON, and every Chat API call mints its own short-lived token
// from it. The probe therefore does exactly that once — sign a JWT with the
// document's private key and exchange it at `token_uri` — so a document that
// cannot mint a token never reaches the store.
//
// The validation restates the vertical's
// `packages/channels/googlechat/src/google-auth.runtime.ts`
// (`validateGoogleChatServiceAccountCredentials`): `type` must be
// `service_account`, `client_email` and `private_key` must be present, and
// `universe_domain` / `auth_uri` / `token_uri` / `auth_provider_x509_cert_url` /
// `client_x509_cert_url` must be Google's own endpoints — a document that
// redirects any of them is REFUSED, because connection create is the only place
// an operator learns the file was tampered with. `googlechat.test.ts` pins the
// restatement to the vertical's validator on the same documents.
//
// The JWT is signed with `node:crypto` rather than `google-auth-library`: Hub
// production code never imports a channel vertical, and the Hub has no reason to
// take on the vertical's auth dependency for one signature.

import { createSign } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative as relative_, resolve } from "node:path";
import type { ChannelBotIdentity, Database } from "../../db/types.js";
import { ChannelCredentialProbeError, probeFetch, probeJson, readString } from "./probe.js";

/** Upstream's own endpoint constants (`google-auth.runtime.ts`). */
const GOOGLE_AUTH_URI = "https://accounts.google.com/o/oauth2/auth";
const GOOGLE_AUTH_TOKEN_URI = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_PROVIDER_CERTS_URL = "https://www.googleapis.com/oauth2/v1/certs";
const GOOGLE_CLIENT_CERTS_URL_PREFIX = "https://www.googleapis.com/robot/v1/metadata/x509/";
const GOOGLE_AUTH_UNIVERSE_DOMAIN = "googleapis.com";
/** The one scope the Chat REST client needs (`api.ts`). */
const CHAT_BOT_SCOPE = "https://www.googleapis.com/auth/chat.bot";
/** Upstream's `MAX_GOOGLE_CHAT_SERVICE_ACCOUNT_FILE_BYTES`. */
export const MAX_SERVICE_ACCOUNT_BYTES = 64 * 1024;
/** Where the FILE form may read from (colon-separated). `CLISBOT_`-aliased. */
export const SERVICE_ACCOUNT_DIRECTORY_VARIABLE = "PASEO_HUB_CHANNEL_SECRETS_DIR";
/** The container secret-mount convention, used when nothing is configured. */
const DEFAULT_SERVICE_ACCOUNT_DIR = "/run/secrets";

export interface GoogleChatServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
  project_id?: string;
}

function trimmed(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function requireExactUrl(record: Record<string, unknown>, field: string, expected: string): void {
  const value = trimmed(record, field);
  if (value !== undefined && value !== expected) {
    throw new ChannelCredentialProbeError(
      `Google Chat service account field "${field}" must be ${expected}, got ${value}`,
      true,
    );
  }
}

/**
 * The validated service account, or a loud refusal. Every check and every
 * message mirrors the vertical's validator: the operator sees the same text
 * whether the document is refused at connection create or at account start.
 */
export function parseGoogleChatServiceAccount(document: unknown): GoogleChatServiceAccount {
  let record: unknown = document;
  if (typeof document === "string") {
    try {
      record = JSON.parse(document);
    } catch {
      throw new ChannelCredentialProbeError("Invalid Google Chat service account JSON.", true);
    }
  }
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new ChannelCredentialProbeError("Invalid Google Chat service account JSON.", true);
  }
  const credentials = record as Record<string, unknown>;
  const type = trimmed(credentials, "type");
  if (type !== undefined && type !== "service_account") {
    throw new ChannelCredentialProbeError(
      `Google Chat credentials must use service_account auth, got "${type}" instead`,
      true,
    );
  }
  const clientEmail = trimmed(credentials, "client_email");
  const privateKey = trimmed(credentials, "private_key");
  if (clientEmail === undefined || privateKey === undefined) {
    throw new ChannelCredentialProbeError(
      "Google Chat service account is missing client_email or private_key",
      true,
    );
  }
  const universeDomain = trimmed(credentials, "universe_domain");
  if (universeDomain !== undefined && universeDomain !== GOOGLE_AUTH_UNIVERSE_DOMAIN) {
    throw new ChannelCredentialProbeError(
      `Google Chat service account field "universe_domain" must be ${GOOGLE_AUTH_UNIVERSE_DOMAIN}, got ${universeDomain}`,
      true,
    );
  }
  requireExactUrl(credentials, "auth_uri", GOOGLE_AUTH_URI);
  requireExactUrl(credentials, "auth_provider_x509_cert_url", GOOGLE_AUTH_PROVIDER_CERTS_URL);
  requireExactUrl(credentials, "token_uri", GOOGLE_AUTH_TOKEN_URI);
  const clientCerts = trimmed(credentials, "client_x509_cert_url");
  if (clientCerts !== undefined && !clientCerts.startsWith(GOOGLE_CLIENT_CERTS_URL_PREFIX)) {
    throw new ChannelCredentialProbeError(
      `Google Chat service account field "client_x509_cert_url" must start with ${GOOGLE_CLIENT_CERTS_URL_PREFIX}, got ${clientCerts}`,
      true,
    );
  }
  const projectId = trimmed(credentials, "project_id");
  return {
    client_email: clientEmail,
    private_key: privateKey.replace(/\\n/gu, "\n"),
    token_uri: trimmed(credentials, "token_uri") ?? GOOGLE_AUTH_TOKEN_URI,
    ...(projectId === undefined ? {} : { project_id: projectId }),
  };
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/** The RS256 self-signed JWT Google exchanges for an access token. */
function signAssertion(account: GoogleChatServiceAccount): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const claims = {
    iss: account.client_email,
    scope: CHAT_BOT_SCOPE,
    aud: account.token_uri,
    iat: issuedAt,
    exp: issuedAt + 3600,
  };
  const signingInput = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify(claims),
  )}`;
  try {
    const signature = createSign("RSA-SHA256").update(signingInput).end();
    return `${signingInput}.${signature.sign(account.private_key, "base64url")}`;
  } catch (error) {
    throw new ChannelCredentialProbeError(
      `the Google Chat service account private key cannot sign: ${error instanceof Error ? error.message : "unknown error"}`,
      true,
    );
  }
}

/** Validate the document, then mint one access token from it. */
export async function probeGoogleChatServiceAccount(
  document: unknown,
): Promise<ChannelBotIdentity> {
  const account = parseGoogleChatServiceAccount(document);
  const response = await probeFetch("Google", account.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signAssertion(account),
    }).toString(),
  });
  const body: unknown = await probeJson(response);
  if (response.status === 400 || response.status === 401) {
    const detail = readString(body, "error_description") ?? readString(body, "error");
    throw new ChannelCredentialProbeError(
      `Google rejected the service account${detail === undefined ? "" : `: ${detail}`}`,
      true,
    );
  }
  if (!response.ok) {
    throw new ChannelCredentialProbeError(
      `the Google token endpoint answered ${response.status}`,
      false,
    );
  }
  if (readString(body, "access_token") === undefined) {
    throw new ChannelCredentialProbeError("Google returned no access token", false);
  }
  return {
    // The service account's own email is its stable identity; the Chat app's
    // `users/<id>` is a space-scoped fact the vertical resolves at start.
    id: account.client_email,
    ...(account.project_id === undefined ? {} : { username: account.project_id }),
    probedAt: new Date().toISOString(),
  };
}

/**
 * The FILE form's path is operator input arriving over the management API, and
 * the Hub reads it with the Hub process's own privileges. Unrestricted, that is
 * a file-read oracle: `/etc/shadow` and the master key file are as readable to
 * this call as a secret mount is, and the parse error that comes back tells the
 * caller which one existed. So the path must resolve inside an allowlisted
 * secrets directory, and every refusal — outside the allowlist, absent, a
 * directory, oversized, unreadable — answers with the same sentence. The
 * operator learns their mount is wrong; a caller probing the filesystem learns
 * nothing beyond "not an allowed secret".
 */
const SERVICE_ACCOUNT_FILE_REFUSED =
  "Google Chat service account file must be a readable JSON document " +
  `under ${SERVICE_ACCOUNT_DIRECTORY_VARIABLE} and at most ${MAX_SERVICE_ACCOUNT_BYTES} bytes.`;

/**
 * The allowlisted secrets directories, colon-separated, defaulting to the
 * container secret-mount convention the catalog help already points operators
 * at. Read per call so a test or an operator restart takes effect without a
 * module reload.
 */
function serviceAccountDirectories(
  environment: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  const configured = environment[SERVICE_ACCOUNT_DIRECTORY_VARIABLE]?.trim();
  const entries = (
    configured === undefined || configured === "" ? DEFAULT_SERVICE_ACCOUNT_DIR : configured
  )
    .split(":")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return entries.map((entry) => resolve(entry));
}

/** True when `candidate` is `directory` itself or sits under it. Both sides are
 * already resolved, so this is a path-segment containment test, not a prefix
 * match (`/run/secrets-other` must not pass for `/run/secrets`). */
function isInside(candidate: string, directory: string): boolean {
  const relative = relative_(directory, candidate);
  return relative !== "" && !relative.startsWith("..") && !isAbsolute(relative);
}

/**
 * The document at `path`, size-capped exactly as the vertical caps it and
 * confined to the secrets allowlist. Symlinks are resolved before the
 * containment test, so a link planted inside the mount cannot point out of it.
 */
export async function readServiceAccountFile(
  path: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const refuse = (): never => {
    throw new ChannelCredentialProbeError(SERVICE_ACCOUNT_FILE_REFUSED, true);
  };
  let resolved: string;
  let size: number;
  try {
    resolved = await realpath(path);
    const stats = await stat(resolved);
    if (!stats.isFile()) return refuse();
    size = stats.size;
  } catch {
    return refuse();
  }
  const allowed = serviceAccountDirectories(environment);
  if (!allowed.some((directory) => isInside(resolved, directory))) return refuse();
  if (size > MAX_SERVICE_ACCOUNT_BYTES) return refuse();
  try {
    return await readFile(resolved, "utf8");
  } catch {
    return refuse();
  }
}

/**
 * Probe the service account, then upsert the organization's Google Chat
 * Connection. The FILE form stores only the path: the document stays on the
 * daemon host where the operator's secret mount put it, and the envelope records
 * where to read it. The INLINE form stores the document itself.
 */
export async function configureGoogleChatConnection(
  database: Database,
  input: {
    organizationId: string;
    accountId: string;
    serviceAccount?: string | undefined;
    serviceAccountFile?: string | undefined;
  },
): Promise<{ connectionId: string; identity: ChannelBotIdentity }> {
  const { serviceAccount, serviceAccountFile } = input;
  if ((serviceAccount === undefined) === (serviceAccountFile === undefined)) {
    throw new ChannelCredentialProbeError(
      "Supply exactly one of the service-account document or its file path",
      true,
    );
  }
  const document =
    serviceAccount ?? (await readServiceAccountFile(serviceAccountFile as unknown as string));
  const identity = await probeGoogleChatServiceAccount(document);
  const { connectionId } = await database.configureChannelConnection({
    organizationId: input.organizationId,
    channel: "googlechat",
    accountId: input.accountId,
    credentials:
      serviceAccountFile === undefined ? { serviceAccount: document } : { serviceAccountFile },
    identity,
  });
  return { connectionId, identity };
}
