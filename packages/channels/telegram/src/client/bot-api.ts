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
import { splitTelegramPlainTextChunks } from "../leaves/rich-message.js";

/** The plane's config record (`ctx.cfg`) — `channels.telegram.accounts.<id>`
 * carries the token strings the outbound path reads (start-account.md). */
export type TelegramCfg = Record<string, unknown>;

export interface TelegramAccountConfig {
  timeoutSeconds?: number;
  apiRoot?: string;
  linkPreview?: boolean;
  richMessages?: boolean;
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
 * narrow interface so tests can fake it without instantiating a Bot. */
export interface TelegramApi {
  getMe(): Promise<TelegramBotInfo>;
  getChat(chatId: string): Promise<{ id: number; type?: string; title?: string }>;
  sendMessage(
    chatId: number,
    text: string,
    params?: Record<string, unknown>,
  ): Promise<{ message_id: number; chat?: { id: number } }>;
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

/** Resolve the drive-time account: token from `ctx.account` (flat carrier)
 * falling back to `cfg.channels.telegram.accounts.<id>.botToken` (the token
 * source per start-account.md), config from the same cfg entry. */
export function resolveTelegramAccount(
  cfg: TelegramCfg,
  accountId: string,
  flatAccount?: Record<string, unknown>,
): ResolvedTelegramAccount {
  const channels = cfg["channels"] as Record<string, unknown> | undefined;
  const telegram = channels?.["telegram"] as Record<string, unknown> | undefined;
  const accounts = telegram?.["accounts"] as Record<string, Record<string, unknown>> | undefined;
  const entry = accounts?.[accountId] ?? {};
  const token = resolveAccountToken(entry, flatAccount);
  if (token === "") {
    throw new Error(
      `Telegram bot token missing for account "${accountId}" (set channels.telegram.accounts.${accountId}.botToken).`,
    );
  }
  const config: TelegramAccountConfig = {};
  const rawConfig = entry["config"] as Record<string, unknown> | undefined;
  if (rawConfig !== undefined) {
    if (typeof rawConfig["timeoutSeconds"] === "number") {
      config.timeoutSeconds = rawConfig["timeoutSeconds"];
    }
    if (typeof rawConfig["apiRoot"] === "string") config.apiRoot = rawConfig["apiRoot"];
    if (typeof rawConfig["linkPreview"] === "boolean") {
      config.linkPreview = rawConfig["linkPreview"];
    }
    if (typeof rawConfig["richMessages"] === "boolean") {
      config.richMessages = rawConfig["richMessages"];
    }
  }
  return { accountId, token, config };
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

/** Build the client options (injected fetch + per-method timeouts + apiRoot)
 * — the pinned `resolveTelegramClientOptions` at its L1 boundary. */
export function buildTelegramClientOptions(
  account: ResolvedTelegramAccount,
  transport?: TelegramTransport,
): TelegramClientOptions {
  const timeoutSeconds =
    typeof account.config.timeoutSeconds === "number" &&
    Number.isFinite(account.config.timeoutSeconds)
      ? Math.max(1, Math.floor(account.config.timeoutSeconds))
      : undefined;
  const fetchImpl = createTelegramClientFetch({
    ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
    ...(transport?.fetch !== undefined ? { transport } : {}),
  });
  return {
    apiRoot: resolveApiRoot(account.config),
    fetchImpl,
    timeoutSeconds,
  };
}

/** Build the default factory options grammy wants (fetch + timeout +
 * apiRoot) — `undefined` when the account matches the public-API defaults. */
function resolveClientOptions(options: TelegramClientOptions): Record<string, unknown> | undefined {
  return options.fetchImpl !== undefined ||
    options.timeoutSeconds !== undefined ||
    options.apiRoot !== "https://api.telegram.org"
    ? {
        ...(options.fetchImpl !== undefined ? { fetch: options.fetchImpl } : {}),
        ...(options.timeoutSeconds !== undefined ? { timeoutSeconds: options.timeoutSeconds } : {}),
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

const TELEGRAM_TEXT_CHUNK_LIMIT = 4000;

/** The per-chunk request params: thread/reply params on the FIRST chunk only
 * (the pinned single-use reply semantics), silent flag always. */
function buildChunkParams(
  params: {
    threadParams?: Record<string, unknown>;
    replyToMessageId?: number;
    messageThreadId?: number;
    silent?: boolean;
  },
  index: number,
): Record<string, unknown> {
  if (index !== 0) return {};
  const base: Record<string, unknown> = { ...params.threadParams };
  if (params.silent === true) base["disable_notification"] = true;
  if (
    params.replyToMessageId === undefined &&
    params.messageThreadId === undefined &&
    Object.keys(base).length === 0
  ) {
    return {};
  }
  return base;
}

/** Send text through the pinned chunk's text path: chunk at 4000, plain
 * (rich-HTML rendering is behind the account's `richMessages` opt-in, off by
 * default), thread params from the topic id, reply-to when given, record the
 * sent message in the seam after each chunk. */
export async function sendTelegramText(
  params: {
    api: TelegramApi;
    chatId: number;
    text: string;
    log?: (message: string) => void;
  } & Pick<SendTextOptions, "replyToMessageId" | "messageThreadId" | "silent"> & {
      threadParams?: Record<string, unknown>;
      recordSent?: (chatId: number, messageId: number) => Promise<void>;
    },
): Promise<SendTextResult> {
  const { api, chatId, text } = params;
  if (!text.trim()) throw new Error("Message must be non-empty for Telegram sends");
  const chunks = splitTelegramPlainTextChunks(text, TELEGRAM_TEXT_CHUNK_LIMIT);
  let lastMessageId = "";
  let lastChatId = String(chatId);
  const log = params.log ?? (() => {});
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (chunk === undefined) continue;
    const requestParams = buildChunkParams(params, index);
    const result = await withTelegramSendRetry(
      () =>
        Object.keys(requestParams).length > 0
          ? api.sendMessage(chatId, chunk, requestParams)
          : api.sendMessage(chatId, chunk),
      `sendMessage chunk ${index + 1}/${chunks.length}`,
      log,
    );
    if (!Number.isFinite(result.message_id)) {
      throw new Error("Telegram sendMessage returned no message_id");
    }
    lastMessageId = String(result.message_id);
    lastChatId = String(result.chat?.id ?? chatId);
    await params.recordSent?.(chatId, result.message_id);
  }
  if (lastMessageId === "") throw new Error("Telegram sendMessage produced no message");
  log(`telegram outbound send ok chatId=${lastChatId} messageId=${lastMessageId}`);
  return { messageId: lastMessageId, chatId: lastChatId };
}

/** The send-error classification re-exported for the Hub's PostFn. */
export type { GrammyErrorType, HttpErrorType, InputFileType };
export {
  isTelegramMessageNotModifiedError,
  isTelegramServerError,
} from "../leaves/telegram-policy.js";
