// L1 Bot API client — in-repo port of the pinned send-BgA996pw.js chunk's
// text-send surface (blueprint §6.5 L1). Sync reference:
// openclaw@2026.7.1-2 dist (see SYNC.md). The pinned chunk carries the full
// media/poll/sticker/topic tool surface; the in-repo vertical keeps only what
// the Hub drive surface needs (text send + chat-id resolution), and points
// every write-back at the plane's keyed-store seam instead of the OpenClaw
// config file (DEVIATIONS.md D-001).
//
// The Bot API calls go through the grammy client with an injected fetch
// (the pinned chunk has zero `fetch(` literals in its send path — same shape
// here), a per-account throttler (grammy stack kept as pinned deps, §7.2),
// and the pinned retry/timeout policy re-implemented at its boundary.

import type { HostKeyedStore, HostKeyedStoreOptions, HostRuntime } from "@getpaseo/channels-shared";
import {
  GrammyError,
  type GrammyError as GrammyErrorType,
  type HttpError as HttpErrorType,
  type InputFile as InputFileType,
} from "grammy";
import {
  createTelegramAccountThrottler,
  createTelegramClientFetch,
  TELEGRAM_OUTBOUND_RETRY_AFTER_CAP_MS,
  isSafeToRetrySendError,
  isTelegramMessageNotModifiedError,
  isTelegramRateLimitError,
  resolveTelegramApiRoot,
  type TelegramTransport,
} from "../leaves/telegram-policy.js";
import {
  formatErrorMessage,
  normalizeOptionalString,
  normalizeStrictInteger,
  parseTelegramTarget,
  wrapTelegramChatNotFoundError,
} from "../leaves/coerce.js";
import { resolveTelegramOutboundClientTimeoutFloorSeconds } from "../client-fetch.js";
import { mergeTelegramAccountConfig } from "../accounts.js";
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";

/** The plane's config record (`ctx.cfg`) — `channels.telegram.accounts.<id>`
 * carries the token strings the outbound path reads (start-account.md). */
export type TelegramCfg = Record<string, unknown>;

export interface TelegramAccountConfig {
  timeoutSeconds?: number;
  apiRoot?: string;
  linkPreview?: boolean;
  /** Markdown → Bot API HTML rendering. ON by default (D-003, amended
   * 2026-08-29): an explicit `config.richMessages: false` opts an account
   * back to plain text. */
  richMessages: boolean;
  /** Slice 20 (webhook receive mode). Set `webhookUrl` to switch the account off
   * polling; the other fields tune the owned listener
   * (`fusion/webhook-session.ts`). Upstream's equivalents live on the same
   * account config (`monitor.types.ts` `webhookPath`/`webhookPort`/
   * `webhookSecret`/`webhookHost`). */
  webhookUrl?: string;
  webhookPort?: number;
  webhookPath?: string;
  webhookSecret?: string;
  webhookHost?: string;
}

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

/** One resolved account (token + config) — the L1's view of `cfg`. */
export interface ResolvedTelegramAccount {
  accountId: string;
  token: string;
  config: TelegramAccountConfig;
}

export interface SendTextResult {
  messageId: string;
  chatId: string;
  [key: string]: unknown;
}

/** A send-text attempt's options (the `baseOpts` of outbound.md, narrowed to
 * the Hub call shape: cfg, accountId, to, threadId, text + optional replyTo). */
export interface SendTextOptions {
  cfg: TelegramCfg;
  accountId?: string;
  token?: string;
  verbose?: boolean;
  replyToMessageId?: number;
  messageThreadId?: number;
  silent?: boolean;
}

/** The Bot API surface the L1 needs (the grammy client's `api`). Kept as a
 * narrow interface so tests can fake it without instantiating a Bot.
 * `editMessageText` mirrors grammy's positional shape (chat_id, message_id,
 * text, other) so the cast of the real client's `api` stays truthful. */
export interface TelegramApi {
  getMe(): Promise<TelegramBotInfo>;
  getChat(chatId: string): Promise<{ id: number; type?: string; title?: string }>;
  sendMessage(
    chatId: number,
    text: string,
    params?: Record<string, unknown>,
  ): Promise<{ message_id: number; chat?: { id: number } }>;
  /** The in-place text update (`editMessageText`) — the approval card's
   * decided state; `other` carries `reply_markup` (COMPAT
   * (clisbot-control-plane)). */
  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    other?: Record<string, unknown>,
  ): Promise<unknown>;
  /** COMPAT(clisbot-control-plane): the liveness surface (`sendChatAction`,
   * typing.md). `"typing"` expires after ~5s, which is why the Hub re-drives a
   * live turn's `start` on a keepalive window. */
  sendChatAction(
    chatId: number,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<unknown>;
  /** COMPAT(clisbot-control-plane): the G7–G10 native-media send methods.
   * `file` is a grammy `InputFile` (the local bytes + native name); the result
   * carries the new message id. The vertical routes mime→method
   * (outbound-media.ts) and calls exactly one of these per post. */
  sendPhoto(
    chatId: number,
    file: unknown,
    params?: Record<string, unknown>,
  ): Promise<{ message_id: number; chat?: { id: number } }>;
  sendDocument(
    chatId: number,
    file: unknown,
    params?: Record<string, unknown>,
  ): Promise<{ message_id: number; chat?: { id: number } }>;
  sendAudio(
    chatId: number,
    file: unknown,
    params?: Record<string, unknown>,
  ): Promise<{ message_id: number; chat?: { id: number } }>;
  sendVoice(
    chatId: number,
    file: unknown,
    params?: Record<string, unknown>,
  ): Promise<{ message_id: number; chat?: { id: number } }>;
  sendVideo(
    chatId: number,
    file: unknown,
    params?: Record<string, unknown>,
  ): Promise<{ message_id: number; chat?: { id: number } }>;
  sendAnimation(
    chatId: number,
    file: unknown,
    params?: Record<string, unknown>,
  ): Promise<{ message_id: number; chat?: { id: number } }>;
  /** Slice 20: the inbound long poll. grammY's `Api.getUpdates` — the vertical
   * no longer builds the `getUpdates` URL itself (`transport/poll.ts` is
   * retired), so the SDK owns the request, the retry-after parse and the
   * `GrammyError` classification `network-errors.ts` reads. */
  getUpdates(params: {
    offset?: number;
    limit?: number;
    timeout?: number;
    allowed_updates?: readonly string[];
  }): Promise<unknown[]>;
  /** Slice 20: the callback-query ack. Silent (no text/alert): it clears the
   * client spinner; the card update is the user-visible outcome. */
  answerCallbackQuery(params: { callback_query_id: string }): Promise<unknown>;
  /** Slice 20: polling must clear a stale webhook first, exactly as upstream's
   * `TelegramPollingSession.#ensureWebhookCleanup` does. */
  deleteWebhook(params?: { drop_pending_updates?: boolean }): Promise<unknown>;
  /** Slice 20: webhook receive mode registers the public URL here. Optional
   * because the fake APIs the unit tests inject only implement what they drive. */
  setWebhook?(url: string, params?: Record<string, unknown>): Promise<unknown>;
}

const BOT_INFO_CACHE_TTL_MS = 86_400_000;

/** The account's token: `botToken` from the cfg entry, falling back to the
 * flat carrier's `token`. */
function resolveAccountToken(
  entry: Record<string, unknown>,
  flatAccount?: Record<string, unknown>,
): string {
  const entryToken = entry["botToken"];
  if (typeof entryToken === "string" && entryToken.trim() !== "") return entryToken.trim();
  const flatToken = flatAccount?.["token"];
  return typeof flatToken === "string" ? flatToken.trim() : "";
}

/** The L1's narrow view of the merged account block. The block is upstream's
 * own flat shape, so every key is read off the entry itself — the same place
 * `accounts.ts` reads it (D-TG-056). */
function narrowAccountConfig(entry: Record<string, unknown>): TelegramAccountConfig {
  // Rich (markdown → Bot API HTML) is the default (D-003, amended 2026-08-29):
  // plain text only when the account explicitly sets `richMessages: false`.
  const config: TelegramAccountConfig = { richMessages: entry["richMessages"] !== false };
  if (typeof entry["timeoutSeconds"] === "number") config.timeoutSeconds = entry["timeoutSeconds"];
  if (typeof entry["apiRoot"] === "string") config.apiRoot = entry["apiRoot"];
  if (typeof entry["linkPreview"] === "boolean") config.linkPreview = entry["linkPreview"];
  if (typeof entry["webhookUrl"] === "string") config.webhookUrl = entry["webhookUrl"];
  if (typeof entry["webhookPort"] === "number") config.webhookPort = entry["webhookPort"];
  if (typeof entry["webhookPath"] === "string") config.webhookPath = entry["webhookPath"];
  if (typeof entry["webhookSecret"] === "string") config.webhookSecret = entry["webhookSecret"];
  if (typeof entry["webhookHost"] === "string") config.webhookHost = entry["webhookHost"];
  return config;
}

/** Resolve the drive-time account: config from the merged
 * `cfg.channels.telegram[.accounts.<id>]` block (`mergeTelegramAccountConfig`
 * — channel-level keys inherited, the account's own keys winning), token from
 * that block's `botToken` falling back to `ctx.account.token` (the flat
 * carrier). One account reader for the whole vertical: this used to read a
 * nested `config` sub-object that no other reader wrote (D-TG-056). */
export function resolveTelegramAccount(
  cfg: TelegramCfg,
  accountId: string,
  flatAccount?: Record<string, unknown>,
): ResolvedTelegramAccount {
  const entry = mergeTelegramAccountConfig(cfg as OpenClawConfig, accountId);
  const token = resolveAccountToken(entry, flatAccount);
  if (token === "") {
    throw new Error(
      `Telegram bot token missing for account "${accountId}" (set channels.telegram.accounts.${accountId}.botToken).`,
    );
  }
  return { accountId, token, config: narrowAccountConfig(entry) };
}

/** The Bot API root: the account's `apiRoot` config when present, else the
 * public API (tests point it at a local server). */
export function resolveApiRoot(config: TelegramAccountConfig): string {
  const apiRoot = normalizeOptionalString(config.apiRoot);
  return apiRoot !== undefined && apiRoot !== ""
    ? resolveTelegramApiRoot(apiRoot)
    : "https://api.telegram.org";
}

export interface TelegramClientOptions {
  apiRoot: string;
  fetchImpl: typeof globalThis.fetch | undefined;
  timeoutSeconds: number | undefined;
}

// A Bot API request must never be allowed to hold the account's per-chat
// throttler forever. The throttler serializes group sends, so one fetch with
// no deadline also blocks every later assistant/progress post for that chat.
/** The client-wide request cap floor. `leaves/telegram-policy.ts` applies ONE
 * flat timeout to every Bot API call, so it has to clear the longest call the
 * client makes: `getUpdates` is held open for the long-poll window (up to 40s,
 * `resolveTelegramLongPollTimeoutSeconds`) and its request budget is 45s.
 * Upstream floors the client timeout at the outbound send budget
 * (`resolveTelegramOutboundClientTimeoutFloorSeconds`, 60s) for the same
 * reason. The port used 30s, which aborted every idle long poll and drove the
 * restart backoff to its 600s max (live 2026-09-07). */
const DEFAULT_TELEGRAM_API_TIMEOUT_SECONDS =
  resolveTelegramOutboundClientTimeoutFloorSeconds(undefined) ?? 60;

/** Build the client options (injected fetch + per-method timeouts + apiRoot)
 * — the pinned `resolveTelegramClientOptions` at its L1 boundary. */
export function buildTelegramClientOptions(
  account: ResolvedTelegramAccount,
  transport?: TelegramTransport,
): TelegramClientOptions {
  const timeoutSeconds =
    resolveTelegramOutboundClientTimeoutFloorSeconds(account.config.timeoutSeconds) ??
    DEFAULT_TELEGRAM_API_TIMEOUT_SECONDS;
  const fetchImpl = createTelegramClientFetch({
    timeoutSeconds,
    ...(transport?.fetch !== undefined ? { transport } : {}),
  });
  return {
    apiRoot: resolveApiRoot(account.config),
    fetchImpl,
    timeoutSeconds,
  };
}

/** Build the default factory options grammy wants (fetch + apiRoot) —
 * `undefined` when the account matches the public-API defaults.
 *
 * `timeoutSeconds` is deliberately NOT handed to grammY (upstream `bot-core.ts`
 * passes `value: undefined` to `resolveTelegramClientTimeoutSeconds`, so it
 * never sets one either). Requests are bounded per method inside the injected
 * fetch (`client-fetch.ts` → `resolveTelegramRequestTimeoutMs`), which knows
 * that `getUpdates` needs 45s. A global client timeout of 30s aborted every
 * idle long poll instead (live 2026-09-07). */
function resolveClientOptions(options: TelegramClientOptions): Record<string, unknown> | undefined {
  return options.fetchImpl !== undefined || options.apiRoot !== "https://api.telegram.org"
    ? {
        ...(options.fetchImpl !== undefined ? { fetch: options.fetchImpl } : {}),
        ...(options.apiRoot !== "https://api.telegram.org" ? { apiRoot: options.apiRoot } : {}),
      }
    : undefined;
}

export type TelegramApiFactory = (
  token: string,
  options?: Record<string, unknown>,
) => Promise<{ api: TelegramApi }>;

/** Create the Bot API client with the per-account throttler installed
 * (the pinned `resolveTelegramApiContext`'s bot construction, narrowed: no
 * proxy/network transport — the plane supplies none today). The grammy
 * stack loads lazily at this call site (the in-repo ESM dist cannot use a
 * sync `require`), so module load stays free of it until a real client is
 * built; tests inject a fake factory instead. */
/** Test seam: a fake Bot API registered under a token, so the outbound path
 * (sendText/sendMedia) picks it up instead of constructing a grammy client.
 * The outbound tests assert on the `sendMessage` / media-method args. */
const apiTestOverrides = new Map<string, TelegramApi>();

/** Test seam: register a fake Bot API for a token (see `apiTestOverrides`). */
export function registerTelegramApiForTest(token: string, api: TelegramApi): void {
  apiTestOverrides.set(token, api);
}

/** Test seam: drop all registered fake Bot APIs. */
export function clearTelegramApiForTest(): void {
  apiTestOverrides.clear();
}

export async function createTelegramApi(
  token: string,
  options: TelegramClientOptions,
  apiFactory: TelegramApiFactory = async (tokenArg, optionsArg) => {
    const { Bot } = await import("grammy");
    const bot = new Bot(tokenArg, optionsArg === undefined ? undefined : { client: optionsArg });
    // The throttler's duck-typed shape isn't grammy's `Transformer`; the
    // pinned chunk installs the same object through the same surface.
    bot.api.config.use((await getOrCreateAccountThrottler(tokenArg)) as never);
    return bot as unknown as { api: TelegramApi };
  },
): Promise<TelegramApi> {
  const override = apiTestOverrides.get(token);
  if (override !== undefined) {
    return override;
  }
  const built = await apiFactory(token, resolveClientOptions(options));
  return built.api;
}

/** The per-account throttler (the pinned `@grammyjs/transformer-throttler`
 * dep, cached per token — same lifetime as the pinned chunk). */
async function getOrCreateAccountThrottler(
  token: string,
): Promise<
  (prev: unknown, method: unknown, payload: unknown, signal: unknown) => Promise<unknown>
> {
  return createTelegramAccountThrottler(token);
}

/** The durable dedupe + cache seams (the pinned `sent-message-cache` chunk's
 * store half, re-targeted at the keyed-store seam — D-001). */
/** The persisted poll-offset value (the L2's state: rotation-detection
 * fields ride along so a revocation drops the offset, poll.ts). */
export interface TelegramUpdateOffsetState {
  lastUpdateId: number;
  botId: string | null;
  tokenFingerprint: string | null;
}

export interface TelegramSeamStores {
  sentMessages: HostKeyedStore<{ chatId: string; messageId: string; timestamp: number }>;
  botInfoCache: HostKeyedStore<{
    tokenFingerprint: string;
    fetchedAt: number;
    bot: TelegramBotInfo;
  }>;
  updateOffsets: HostKeyedStore<TelegramUpdateOffsetState>;
}

/** The shared seam's `openKeyedStore` is untyped; the vertical views each
 * namespace through its own value shape (the cast is the typed-store seam). */
function openTypedStore<T>(
  hostRuntime: HostRuntime,
  options: HostKeyedStoreOptions,
): HostKeyedStore<T> {
  return hostRuntime.state.openKeyedStore(options) as unknown as HostKeyedStore<T>;
}

export function openTelegramSeamStores(hostRuntime: HostRuntime): TelegramSeamStores {
  return {
    sentMessages: openTypedStore<{ chatId: string; messageId: string; timestamp: number }>(
      hostRuntime,
      {
        namespace: "telegram.sent-messages",
        maxEntries: 10_000,
        defaultTtlMs: 86_400_000,
      },
    ),
    botInfoCache: openTypedStore<{
      tokenFingerprint: string;
      fetchedAt: number;
      bot: TelegramBotInfo;
    }>(hostRuntime, {
      namespace: "telegram.bot-info-cache",
      maxEntries: 128,
      defaultTtlMs: BOT_INFO_CACHE_TTL_MS,
    }),
    updateOffsets: openTypedStore<TelegramUpdateOffsetState>(hostRuntime, {
      namespace: "telegram.update-offsets",
      maxEntries: 1000,
    }),
  };
}

/** A 4xx chat-not-found / not-member error with the pinned fix-it message. */
export function wrapTelegramSendError(err: unknown, chatId: number, input: string): unknown {
  return wrapTelegramChatNotFoundError(err, { chatId: String(chatId), input });
}

/** Retry a Bot API send with the pinned outbound retry policy: safe-to-retry
 * or rate-limit errors retry (bounded by the pinned retry-after cap). */
export async function withTelegramSendRetry<T>(
  fn: () => Promise<T>,
  label: string,
  log: (message: string) => void,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      const retryable = isSafeToRetrySendError(err) || isTelegramRateLimitError(err);
      if (!retryable || attempt >= 4) throw err;
      const delayMs = resolveRetryDelayMs(err, TELEGRAM_OUTBOUND_RETRY_AFTER_CAP_MS);
      log(`telegram ${label} failed (${formatErrorMessage(err)}); retrying in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
}

/** Resolve the 429 `retry_after` into a bounded delay (the pinned
 * `retry-after.ts` boundary). */
export function resolveRetryDelayMs(err: unknown, capMs: number): number {
  if (err instanceof GrammyError) {
    const retryAfter = err.parameters?.retry_after;
    if (typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > 0) {
      return Math.min(Math.round(retryAfter * 1000), capMs);
    }
  }
  return Math.min(3000, capMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Resolve the recipient to a numeric chat id: numeric pass-through, else a
 * `getChat` lookup. The pinned `resolveAndPersistChatId`'s resolution half —
 * the persist half is the seam write-back below (D-001). */
export async function resolveChatId(
  to: string | number,
  api: TelegramApi,
  verbose?: boolean,
): Promise<number> {
  const normalized = normalizeTelegramChatId(to);
  if (normalized !== undefined) return normalized;
  const lookupTarget = normalizeLookupTarget(to);
  if (lookupTarget === undefined || lookupTarget === "") {
    throw new Error(`Telegram recipient must be a numeric chat ID (got "${String(to)}")`);
  }
  try {
    const chat = await api.getChat(lookupTarget);
    const resolved = normalizeTelegramChatId(String(chat.id));
    if (resolved === undefined) {
      throw new Error(`resolved chat id is not numeric (${String(chat.id)})`);
    }
    if (verbose) {
      // Caller-side logging; the L1 stays logger-free.
    }
    return resolved;
  } catch (err) {
    throw new Error(
      `Telegram recipient ${lookupTarget} could not be resolved to a numeric chat ID (${formatErrorMessage(err)})`,
      { cause: err },
    );
  }
}

function normalizeTelegramChatId(raw: string | number): number | undefined {
  const value = typeof raw === "number" ? raw : String(raw).trim();
  return normalizeStrictInteger(value);
}

function normalizeLookupTarget(raw: string | number): string | undefined {
  const value = typeof raw === "number" ? String(raw) : raw.trim();
  if (value === "") return undefined;
  if (normalizeStrictInteger(value) !== undefined) return value;
  // Username lookups: normalize the casing of the `@user` span.
  return value.startsWith("@") ? value.toLowerCase() : value;
}

/** Parse the outbound target (`to` — numeric chat id or `@username`, optional
 * `:topic:<id>` suffix). */
export function parseOutboundTarget(to: string): { chatId: string; messageThreadId?: number } {
  const parsed = parseTelegramTarget(to);
  const messageThreadId =
    parsed.messageThreadId !== null && parsed.messageThreadId !== undefined
      ? parsed.messageThreadId
      : undefined;
  return {
    chatId: parsed.chatId,
    ...(messageThreadId !== undefined ? { messageThreadId } : {}),
  };
}

// D-TG-026: `sendTelegramText` and `editTelegramMessageText` lived here as the
// local reimplementation of the OpenClaw text send/edit. They are superseded by
// the ported source (`../send-message.ts`, `../send-edit.ts`) and were deleted
// with slice 9. What remains in this module is the inbound/lifecycle half the
// Hub still drives: account + api-root resolution, the grammy client factory,
// the update-offset / sent-message seam stores, chat-id resolution and the
// retry/error helpers those use.

/** The send-error classification re-exported for the Hub's PostFn. */
export type { GrammyErrorType, HttpErrorType, InputFileType };
export { isTelegramServerError } from "../leaves/telegram-policy.js";
export { isTelegramMessageNotModifiedError };
