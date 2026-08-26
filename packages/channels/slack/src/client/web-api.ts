// L1 — the Slack Web API client layer (blueprint §6.5: a THIN wrapper over the
// pinned npm dep @slack/web-api; the pinned tarball's bundled node_modules are
// NOT vendored). Sync reference: @openclaw/slack@2026.7.1
// dist/client-DGxwSL7f.js (client options + write-client cache),
// dist/probe-CuwRDE5j.js (auth.test probe),
// dist/accounts-BOJJiHSr.js (bot-token identity warning).
//
// No OpenClaw imports: the pinned vertical resolves its clients through
// openclaw/plugin-sdk fetch/proxy helpers; in-repo the client is a straight
// @slack/web-api WebClient (DEVIATIONS D-002).
//
// The WebClient is loaded through a dynamic import inside the client
// factories so this module's pure surface (probe, error shaping, constants)
// stays importable — and testable — before the pinned dep is installed
// (DEVIATIONS D-004).

import { createHash } from "node:crypto";

type WebClientCtor = new (token: string, options?: unknown) => WebClient;

interface WebClientInstance {
  auth: { test(args?: unknown): Promise<AuthTestResult> };
  chat: {
    postMessage(args: {
      channel: string;
      text?: string;
      thread_ts?: string;
      [key: string]: unknown;
    }): Promise<{ ts?: string; channel?: string; [key: string]: unknown }>;
  };
  [key: string]: unknown;
}

/** The WebClient surface the vertical uses (structural subset of
 * @slack/web-api's `WebClient` — the vertical never imports OpenClaw types). */
export type WebClient = WebClientInstance;

/** The `auth.test` response facts (structural subset of
 * @slack/web-api's `AuthTestResponse`). */
export interface AuthTestResult {
  ok: boolean;
  error?: string;
  user_id?: string;
  bot_id?: string;
  team_id?: string;
  api_app_id?: string;
  user?: string;
  team?: string;
  [key: string]: unknown;
}

/** The write-path chat.postMessage response facts. */
export interface ChatPostMessageResult {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
  [key: string]: unknown;
}

/** The `chat.postMessage` args the write path passes. */
export interface ChatPostMessageArgs {
  channel: string;
  text?: string;
  thread_ts?: string;
  [key: string]: unknown;
}

/** WebClientOptions (structural subset — the factory only reads the fields it
 * forwards). */
export interface WebClientOptions {
  slackApiUrl?: string;
  retryConfig?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Slack's text limit as pinned (SLACK_TEXT_LIMIT = 8e3,
 * reply-blocks-BGQ6zSqM.js:831) — the in-repo P0 sendText does not chunk;
 * the constant is kept for any future chunking path to track the pinned
 * boundary. */
export const SLACK_TEXT_LIMIT = 8000;

/** Default retry policy (pinned SLACK_DEFAULT_RETRY_OPTIONS). Read-path
 * clients keep their retries; writes are retried by the caller. */
export const SLACK_DEFAULT_RETRY_OPTIONS = {
  retries: 2,
  factor: 2,
  minTimeout: 500,
  maxTimeout: 3000,
  randomize: true,
} as const;

/** The write-path client does NOT retry: the Hub's delivery ledger owns
 * retry accounting (pinned SLACK_WRITE_RETRY_OPTIONS). */
export const SLACK_WRITE_RETRY_OPTIONS = { retries: 0 } as const;

/** The `SLACK_API_URL` env override the pinned vertical honors
 * (client-options.ts `resolveSlackApiUrlFromEnv`). */
export function resolveSlackApiUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env["SLACK_API_URL"]?.trim() || undefined;
}

/** LRU bound for the shared write-client cache (pinned
 * SLACK_WRITE_CLIENT_CACHE_MAX = 32). */
export const SLACK_WRITE_CLIENT_CACHE_MAX = 32;

const writeClientCache = new Map<string, WebClient>();

/** One-way token → cache key: the token itself never appears in the key. */
export function createSlackTokenCacheKey(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("base64url")}`;
}

/** The dynamic dep load (DEVIATIONS D-004): the WebClient ctor, loaded once. */
async function loadWebClientCtor(): Promise<WebClientCtor> {
  const { WebClient } = await import("@slack/web-api");
  return WebClient as unknown as WebClientCtor;
}

/** The resolved `slackApiUrl` (explicit option → env → undefined). */
function resolveSlackApiUrl(options: WebClientOptions): string | undefined {
  return options.slackApiUrl ?? resolveSlackApiUrlFromEnv();
}

/** WebClient ctor options with the resolved api url + retry policy. */
function buildClientOptions(
  options: WebClientOptions,
  retryConfig: Record<string, unknown>,
): Record<string, unknown> {
  const api = resolveSlackApiUrl(options);
  return {
    ...options,
    ...(api !== undefined ? { slackApiUrl: api } : {}),
    retryConfig,
  };
}

/** A fresh read-path WebClient with the pinned default retry policy. */
export async function createSlackWebClient(
  token: string,
  options: WebClientOptions = {},
): Promise<WebClient> {
  const WebClient = await loadWebClientCtor();
  return new WebClient(
    token,
    buildClientOptions(options, options.retryConfig ?? { ...SLACK_DEFAULT_RETRY_OPTIONS }),
  );
}

/** A write-path WebClient (no retries) shared per (token, api url) — one
 * Slack rate-limit pool per account, the same way the pinned vertical
 * shares its write client. */
export async function getSlackWriteClient(
  token: string,
  options: WebClientOptions = {},
): Promise<WebClient> {
  const api = resolveSlackApiUrl(options);
  const key =
    api === undefined
      ? createSlackTokenCacheKey(token)
      : `${createSlackTokenCacheKey(token)}:api:${api}`;
  const cached = writeClientCache.get(key);
  if (cached !== undefined) {
    writeClientCache.delete(key);
    writeClientCache.set(key, cached);
    return cached;
  }
  const WebClient = await loadWebClientCtor();
  const client = new WebClient(
    token,
    buildClientOptions(options, { ...SLACK_WRITE_RETRY_OPTIONS }),
  );
  if (writeClientCache.size >= SLACK_WRITE_CLIENT_CACHE_MAX) {
    const oldest = writeClientCache.keys().next().value;
    if (oldest !== undefined) writeClientCache.delete(oldest);
  }
  writeClientCache.set(key, client);
  return client;
}

/** Test seam: drop the cached write clients. */
export function clearSlackWriteClientCacheForTest(): void {
  writeClientCache.clear();
}

// --- auth.test probe (pinned probe-CuwRDE5j.js) -------------------------------

/** The probe result: the identity facts L4 needs to run mention gating. */
export interface SlackAuthProbeResult {
  ok: boolean;
  status: number | null;
  elapsedMs: number;
  /** The bot user id (`U…`) — empty when the token is not a bot token. */
  botUserId?: string;
  /** The bot id (`B…`). */
  botId?: string;
  teamId?: string;
  apiAppId?: string;
  /** The bot's display name (auth.test `user`). */
  botName?: string;
  teamName?: string;
  /** Set when the token looks like a user token (no bot_id). */
  warning?: string;
  /** The error text when `ok` is false. */
  error?: string;
}

/** The identity fields of a success probe result (non-empty strings only). */
interface ProbeIdentityFields {
  botUserId?: string;
  botId?: string;
  teamId?: string;
  apiAppId?: string;
  botName?: string;
  teamName?: string;
}

/** The identity fields from an `auth.test` result (non-empty strings only). */
function buildProbeIdentityFields(result: AuthTestResult): ProbeIdentityFields {
  const botUserId = nonEmptyString(result.user_id?.trim());
  const botId = nonEmptyString(result.bot_id?.trim());
  const teamId = nonEmptyString(result.team_id);
  const apiAppId = nonEmptyString(result.api_app_id);
  const botName = nonEmptyString(result.user);
  const teamName = nonEmptyString(result.team);
  return {
    ...(botUserId !== undefined ? { botUserId } : {}),
    ...(botId !== undefined ? { botId } : {}),
    ...(teamId !== undefined ? { teamId } : {}),
    ...(apiAppId !== undefined ? { apiAppId } : {}),
    ...(botName !== undefined ? { botName } : {}),
    ...(teamName !== undefined ? { teamName } : {}),
  };
}

/** A non-empty string, or undefined. */
function nonEmptyString(value: string | undefined): string | undefined {
  return value !== undefined && value !== "" ? value : undefined;
}

/** One success probe result: the identity facts + the user-token warning. */
function buildProbeSuccess(
  result: AuthTestResult,
  elapsedMs: number,
  accountId: string | undefined,
): SlackAuthProbeResult {
  const fields = buildProbeIdentityFields(result);
  const warning = formatSlackBotTokenIdentityWarning({
    ...(fields.botUserId !== undefined ? { botUserId: fields.botUserId } : {}),
    ...(fields.botId !== undefined ? { botId: fields.botId } : {}),
    ...(accountId !== undefined ? { accountId } : {}),
  });
  return {
    ok: true,
    status: 200,
    elapsedMs,
    ...fields,
    ...(warning !== undefined ? { warning } : {}),
  };
}

/** One failure probe result from a non-ok `auth.test` response. */
function buildProbeFailure(
  error: string | undefined,
  elapsedMs: number,
  status: number | null,
): SlackAuthProbeResult {
  return { ok: false, status, error: error ?? "unknown", elapsedMs };
}

/** Warn when auth.test identifies a USER, not a bot (pinned
 * formatSlackBotTokenIdentityWarning): explicit bot-mention detection
 * cannot run without the bot user id, so required-mention rooms fail
 * closed until the token is replaced. */
export function formatSlackBotTokenIdentityWarning(params: {
  botUserId?: string;
  botId?: string;
  accountId?: string;
}): string | undefined {
  const userId = params.botUserId?.trim();
  const botId = params.botId?.trim();
  if (userId === undefined || userId === "" || (botId !== undefined && botId !== ""))
    return undefined;
  const accountId = params.accountId?.trim() || "default";
  return `Slack auth.test identified account "${accountId}" as user ${userId} without bot_id. channels.slack.accounts.${accountId}.botToken appears to contain a user token; replace it with a Bot User OAuth Token. Until replaced, explicit bot-mention detection is disabled and required-mention channels fail closed.`;
}

/** One `auth.test` round-trip against the bot token, bounded by a timeout.
 * Port of pinned `probeSlack` (probe-CuwRDE5j.js) — the L4 probe. `opts.client`
 * is the injected WebClient (tests); absent, a fresh read client is created. */
export async function probeSlackAuth(
  botToken: string,
  timeoutMs = 2500,
  opts: { accountId?: string; client?: WebClient } = {},
): Promise<SlackAuthProbeResult> {
  const client = opts.client ?? (await createSlackWebClient(botToken));
  const start = Date.now();
  try {
    const result = await withTimeout(client.auth.test({}), timeoutMs);
    if (!result.ok) {
      return buildProbeFailure(result.error, Date.now() - start, 200);
    }
    return buildProbeSuccess(result, Date.now() - start, opts.accountId);
  } catch (error) {
    return buildProbeFailure(
      error instanceof Error ? error.message : String(error),
      Date.now() - start,
      error instanceof SlackApiError ? error.status : null,
    );
  }
}

// --- error shaping ------------------------------------------------------------

/** A Slack Web API error enriched with the `data` payload (pinned
 * `enrichSlackWebApiError`): `error.error` is the machine-readable code
 * (`invalid_auth`, `channel_not_found`, …) the reconnect classifier and the
 * failure logs key on. */
export class SlackApiError extends Error {
  readonly error: string;
  readonly status: number;
  readonly data: unknown;

  constructor(message: string, error: string, status: number, data: unknown) {
    super(message);
    this.name = "SlackApiError";
    this.error = error;
    this.status = status;
    this.data = data;
  }
}

/** Extract the Slack error facts from a web-api failure, if it carries
 * them; undefined otherwise (a non-Slack fault — e.g. DNS). */
export function extractSlackApiError(error: unknown):
  | {
      code: string;
      status: number;
      data: unknown;
    }
  | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const candidate = error as { error?: unknown; data?: unknown; statusCode?: unknown };
  if (typeof candidate.error !== "string" || candidate.error === "") return undefined;
  return {
    code: candidate.error,
    status: typeof candidate.statusCode === "number" ? candidate.statusCode : 0,
    data: candidate.data,
  };
}

/** A human one-liner for a web-api failure (pinned `formatSlackError`). */
export function formatSlackError(error: unknown): string {
  const facts = extractSlackApiError(error);
  if (facts !== undefined) {
    return `Slack API error: ${facts.code} (HTTP ${facts.status === 0 ? "n/a" : facts.status})`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** `NO_REPLY` — the silent-answer token (pinned `isSilentReplyText`,
 * case-insensitive exact match). */
export function isSilentReplyText(text: string): boolean {
  return text.trim().toUpperCase() === "NO_REPLY";
}

/** Promise timeout: rejects when the bound elapses; the pinned vertical
 * uses the SDK's `withTimeout` helper. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
        return undefined;
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
        return undefined;
      },
    );
  });
}
