// L2 getUpdates long-poll transport (blueprint §6.5 L2 — `hosts/telegram-monitor`
// mechanics moved into the in-repo vertical). Direct Bot API fetch: no grammy
// in the loop (the pinned host monitor is fetch-only too, telegram-monitor.md);
// grammy stays the L1 client stack. Offsets persist in the plane's keyed-store
// seam (`telegram.update-offsets`), per account; the durable inbound ledger +
// in-flight dedupe live in the shared L3 processor this transport feeds.

import type {
  ChannelInboundEvent,
  HostChildLogger,
  HostKeyedStore,
} from "@getpaseo/channels-shared";
import { createHash } from "node:crypto";

/** Long-poll timeout in seconds (the pinned monitor's 50s window). */
export const TELEGRAM_POLL_TIMEOUT_SECONDS = 50;
/** Max updates per getUpdates call. */
export const TELEGRAM_POLL_LIMIT = 100;
/** getUpdates backoff after a recoverable fault. */
const TELEGRAM_POLL_RETRY_DELAY_MS = 1_000;

/** The native message fields the L2 normalizes (subset of the Bot API). */
export interface TelegramUpdateShape {
  update_id: number;
  message?: TelegramMessageShape;
  channel_post?: TelegramMessageShape;
  edited_message?: TelegramMessageShape;
  edited_channel_post?: TelegramMessageShape;
}

export interface TelegramMessageShape {
  message_id: number;
  date?: number;
  text?: string;
  chat?: {
    id: number;
    type?: string;
    title?: string;
    username?: string;
  };
  from?: {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    username?: string;
  };
  entities?: Array<{ type: string; user?: { id: number } }>;
  message_thread_id?: number;
}

export interface TelegramPollOptions {
  accountId: string;
  botToken: string;
  apiRoot: string;
  /** The bot's own user id (from the L4 probe) — own-message filter. */
  botId: number;
  botUsername?: string;
  abortSignal: AbortSignal;
  updateOffsetStore: HostKeyedStore<{
    lastUpdateId: number;
    botId: string | null;
    tokenFingerprint: string | null;
  }>;
  onEvent: (event: ChannelInboundEvent) => Promise<void>;
  fetchImpl?: typeof globalThis.fetch;
  logger?: HostChildLogger;
  /** Test hook: fake the getUpdates HTTP call. */
  pollFn?: (params: {
    offset: number;
    timeoutSeconds: number;
    limit: number;
  }) => Promise<TelegramUpdateShape[]>;
}

/** `allowed_updates` for the poll: the grammy default set + reactions
 * (the pinned `allowed-updates.ts`; inlined here so the L2 loads grammy-free). */
export function resolveTelegramAllowedUpdates(): string[] {
  return [
    "message",
    "edited_message",
    "channel_post",
    "edited_channel_post",
    "business_connection",
    "business_message",
    "edited_business_message",
    "deleted_business_message",
    "chat_member",
    "user_chat_member",
    "message_reaction",
  ];
}

/** The bot user id prefix of a token (`123456:abc…` → `123456`). */
export function telegramBotIdFromToken(token: string): string | null {
  const raw = token.trim().split(":", 1)[0];
  return raw !== undefined && /^\d+$/.test(raw) ? raw : null;
}

/** The short token fingerprint persisted with the offset (rotation detect;
 * the token itself never lands in the store). */
export function fingerprintTelegramBotToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

type UpdateOffsetStore = TelegramPollOptions["updateOffsetStore"];

/** Read the persisted poll offset for an account; `null` on first sight,
 * token rotation, or a bot-id change (the offset belongs to one bot). */
export async function readUpdateOffset(
  store: UpdateOffsetStore,
  botToken: string,
): Promise<number | null> {
  const state = await readOffsetState(store);
  if (state === null) return null;
  const currentBotId = telegramBotIdFromToken(botToken);
  if (currentBotId === null || state.lastUpdateId === null) return null;
  if (state.botId === null || state.tokenFingerprint === null) return null;
  if (state.botId !== currentBotId) return null;
  if (state.tokenFingerprint !== fingerprintTelegramBotToken(botToken)) return null;
  return state.lastUpdateId;
}

type OffsetState = { lastUpdateId: number; botId: string; tokenFingerprint: string } | null;

async function readOffsetState(
  store: TelegramPollOptions["updateOffsetStore"],
): Promise<OffsetState> {
  try {
    const stored = await store.lookup("telegram");
    if (typeof stored?.lastUpdateId !== "number" || !Number.isSafeInteger(stored.lastUpdateId)) {
      return null;
    }
    if (typeof stored.botId !== "string" || typeof stored.tokenFingerprint !== "string") {
      return null;
    }
    return {
      lastUpdateId: stored.lastUpdateId,
      botId: stored.botId,
      tokenFingerprint: stored.tokenFingerprint,
    };
  } catch {
    return null;
  }
}

/** Persist the poll offset (keyed per account; one key per store root). */
export async function writeUpdateOffset(
  store: TelegramPollOptions["updateOffsetStore"],
  botToken: string,
  lastUpdateId: number,
): Promise<void> {
  if (!Number.isSafeInteger(lastUpdateId) || lastUpdateId < 0) {
    throw new Error("Telegram update offset must be a non-negative safe integer");
  }
  const botId = telegramBotIdFromToken(botToken);
  await store.register("telegram", {
    lastUpdateId,
    botId,
    tokenFingerprint: fingerprintTelegramBotToken(botToken),
  });
}

/** One getUpdates call against the Bot API (direct fetch, long-poll). */
async function fetchUpdates(params: {
  botToken: string;
  apiRoot: string;
  offset: number;
  timeoutSeconds: number;
  fetchImpl: typeof globalThis.fetch | undefined;
}): Promise<TelegramUpdateShape[]> {
  const { botToken, apiRoot, offset, timeoutSeconds, fetchImpl } = params;
  const fetchFn = fetchImpl ?? globalThis.fetch;
  const url = `${apiRoot}/bot${encodeURIComponent(botToken)}/getUpdates?offset=${encodeURIComponent(String(offset))}&limit=${TELEGRAM_POLL_LIMIT}&timeout=${timeoutSeconds}`;
  const response = await fetchFn(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Telegram getUpdates failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { ok: boolean; result?: unknown; description?: string };
  if (body.ok !== true || !Array.isArray(body.result)) {
    throw new Error(`Telegram getUpdates failed: ${body.description ?? "malformed response"}`);
  }
  return body.result as TelegramUpdateShape[];
}

function pickMessage(update: TelegramUpdateShape): {
  message: TelegramMessageShape;
  kind: "message" | "channel_post" | "edited";
} | null {
  if (update.message !== undefined) return { message: update.message, kind: "message" };
  if (update.channel_post !== undefined)
    return { message: update.channel_post, kind: "channel_post" };
  if (update.edited_message !== undefined || update.edited_channel_post !== undefined) {
    const message = update.edited_message ?? update.edited_channel_post;
    return message === undefined ? null : { message, kind: "edited" };
  }
  return null;
}

/** Normalize one native update into the shared L3 inbound event, or `null`
 * when it carries no actionable text message. */
export function normalizeTelegramInboundEvent(
  update: TelegramUpdateShape,
  params: { accountId: string; botId: number; botUsername?: string },
): ChannelInboundEvent | null {
  const picked = pickMessage(update);
  if (picked === null || update.update_id === undefined) return null;
  const { message } = picked;
  const chat = message.chat;
  const from = message.from;
  const text = typeof message.text === "string" ? message.text : "";
  if (chat === undefined || chat.id === undefined || from === undefined || from.id === undefined) {
    return null;
  }
  const senderId = String(from.id);
  const wasMentioned = resolveMentioned(message, params.botId, params.botUsername);
  const chatType = chat.type === "private" ? "direct" : "group";
  const dateSeconds = message.date;
  return {
    channel: "telegram",
    externalEventId: `update:${update.update_id}`,
    externalMessageId: String(message.message_id),
    externalConversationId: String(chat.id),
    chatType,
    messageThreadId:
      message.message_thread_id !== undefined ? String(message.message_thread_id) : null,
    senderId,
    ...(from.first_name !== undefined ? { senderName: from.first_name } : {}),
    ...(from.username !== undefined ? { senderUsername: from.username } : {}),
    body: text,
    wasMentioned,
    timestampMs: typeof dateSeconds === "number" ? dateSeconds * 1000 : Date.now(),
    ...(chat.title !== undefined ? { conversationLabel: chat.title } : {}),
    // Loop guard: flag own ONLY when the sender is the bot under test itself
    // (id match). A *different* bot (e.g. the E2E master-bot external sender,
    // or any automation bot) is NOT own — it is a legitimate external sender
    // the bot under test should be able to answer. `is_bot` alone was too
    // broad: it silently dropped every bot-authored message at L3.
    isOwnMessage: senderId === String(params.botId),
  };
}

/** Mention facts: an entity-mention of the bot, a `@username` span, or a
 * `/command` addressed to the bot. The policy decision stays on the Hub. */
export function resolveMentioned(
  message: TelegramMessageShape,
  botId: number,
  botUsername?: string,
): boolean {
  const entities = message.entities ?? [];
  for (const entity of entities) {
    if (entity.type === "mention" && entity.user?.id === botId) return true;
  }
  const text = message.text ?? "";
  if (botUsername !== undefined && botUsername !== "" && text.includes(`@${botUsername}`)) {
    return true;
  }
  // A command line (`/start`, `/dothing@botname`) addresses the group bots
  // that own it; the bot-id-prefix match is the explicit-address form.
  return /^\s*\/[a-z0-9_]+/i.test(text);
}

/** One getUpdates call through the transport (fake or HTTP); `null` on a
 * recoverable fault after logging + backoff (P13 — a fault never kills the
 * account). */
async function fetchBatch(
  opts: TelegramPollOptions,
  offset: number,
): Promise<TelegramUpdateShape[] | null> {
  try {
    if (opts.pollFn !== undefined) {
      return await opts.pollFn({
        offset,
        timeoutSeconds: TELEGRAM_POLL_TIMEOUT_SECONDS,
        limit: TELEGRAM_POLL_LIMIT,
      });
    }
    return await fetchUpdates({
      botToken: opts.botToken,
      apiRoot: opts.apiRoot,
      offset,
      timeoutSeconds: TELEGRAM_POLL_TIMEOUT_SECONDS,
      fetchImpl: opts.fetchImpl,
    });
  } catch (error) {
    if (opts.abortSignal.aborted) throw error;
    opts.logger?.warn("telegram poll fault (kept polling)", {
      accountId: opts.accountId,
      error: error instanceof Error ? error.message : String(error),
    });
    await abortableSleep(TELEGRAM_POLL_RETRY_DELAY_MS, opts.abortSignal);
    return null;
  }
}

/** Hand a batch's events to the processor (L3 swallows handoff faults) and
 * report the max update id seen. */
async function dispatchBatch(
  opts: TelegramPollOptions,
  updates: TelegramUpdateShape[],
): Promise<number> {
  let maxUpdateId = 0;
  for (const update of updates) {
    if (update.update_id === undefined || !Number.isSafeInteger(update.update_id)) continue;
    if (update.update_id > maxUpdateId) maxUpdateId = update.update_id;
    const event = normalizeTelegramInboundEvent(update, {
      accountId: opts.accountId,
      botId: opts.botId,
      ...(opts.botUsername !== undefined ? { botUsername: opts.botUsername } : {}),
    });
    if (event === null) continue;
    try {
      await opts.onEvent(event);
    } catch {
      // The offset persistence after the batch is what acks; a throw here
      // must not kill the loop.
    }
  }
  return maxUpdateId;
}

/** The poll loop: read the offset, long-poll, hand each event on, persist
 * the max offset after each batch. Runs until `abortSignal` fires. */
export async function runTelegramPoll(opts: TelegramPollOptions): Promise<void> {
  let offset = await readUpdateOffset(opts.updateOffsetStore, opts.botToken);
  let effectiveOffset = offset === null ? 0 : offset + 1;
  for (;;) {
    if (opts.abortSignal.aborted) return;
    const batch = await fetchBatch(opts, effectiveOffset);
    if (batch === null) continue;
    const maxUpdateId = await dispatchBatch(opts, batch);
    if (maxUpdateId > (offset ?? 0)) {
      try {
        await writeUpdateOffset(opts.updateOffsetStore, opts.botToken, maxUpdateId);
        offset = maxUpdateId;
        effectiveOffset = maxUpdateId + 1;
      } catch (error) {
        opts.logger?.warn("telegram offset persist failed (will re-deliver)", {
          accountId: opts.accountId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  const timer = new Promise<void>((resolve) => {
    setTimeout(() => resolve(), ms);
  });
  const aborted = new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
  return Promise.race([timer, aborted]);
}
