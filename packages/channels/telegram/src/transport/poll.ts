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
import type { TelegramCallbackQueryShape } from "./approval-callback.js";
import { foldInboundTelegramMedia } from "./media.js";

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
  /** COMPAT(clisbot-control-plane): the approval card's button click (E2 —
   * mirrored from the Slack vertical's `block_actions` envelope). */
  callback_query?: TelegramCallbackQueryShape;
}

/** The Bot API file carriers (photo elements and the single-carrier fields).
 * The media fields are the inbound-media subset (group G): `file_id` for the
 * download, `file_size` for the largest-photo pick, `file_name` for the
 * document's saved name. Stickers are out of scope. */
export interface TelegramFileShape {
  file_id?: string;
  file_unique_id?: string;
  file_size?: number;
  file_name?: string;
}

export interface TelegramMessageShape {
  message_id: number;
  date?: number;
  text?: string;
  /** The media caption (group G: a caption with a mention must also steer). */
  caption?: string;
  photo?: TelegramFileShape[];
  document?: TelegramFileShape;
  audio?: TelegramFileShape;
  voice?: TelegramFileShape;
  video?: TelegramFileShape;
  animation?: TelegramFileShape;
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
  /** COMPAT(clisbot-control-plane): one approval-card button click (E2 — the
   * `callback_query` half of the Slack `block_actions` seam). The transport
   * acks FIRST (silent `answerCallbackQuery`) and hands the raw update to
   * this callback; a faulty/absent callback must never wedge the poll (the
   * ack already stopped the redelivery). The hub's exactly-once resolver
   * makes a stale second tap inert. Absent = no card clicks (the typed
   * command still answers the prompt). */
  onApprovalCallback?: (callbackQuery: TelegramCallbackQueryShape) => Promise<void>;
  fetchImpl?: typeof globalThis.fetch;
  logger?: HostChildLogger;
  /** The account's inbound-media download dir (`<dataDir>/channels/<accountId>/downloads`).
   * Undefined = media not downloaded (the fold is skipped; caption-only bodies). */
  downloadDir?: string;
  /** Test hook: fake the getUpdates HTTP call. */
  pollFn?: (params: {
    offset: number;
    timeoutSeconds: number;
    limit: number;
  }) => Promise<TelegramUpdateShape[]>;
}

/** `allowed_updates` for the poll: the grammy default set + reactions
 * (the pinned `allowed-updates.ts`; inlined here so the L2 loads grammy-free)
 * + `callback_query` (COMPAT(clisbot-control-plane), E2 — the approval
 * card's button clicks arrive as `callback_query` updates, the mirror of
 * the Slack vertical's `block_actions` envelope). */
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
    "callback_query",
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
  abortSignal: AbortSignal;
  fetchImpl: typeof globalThis.fetch | undefined;
}): Promise<TelegramUpdateShape[]> {
  const { botToken, apiRoot, offset, timeoutSeconds, abortSignal, fetchImpl } = params;
  const fetchFn = fetchImpl ?? globalThis.fetch;
  const url =
    `${apiRoot}/bot${encodeURIComponent(botToken)}/getUpdates?offset=${encodeURIComponent(String(offset))}` +
    `&limit=${TELEGRAM_POLL_LIMIT}&timeout=${timeoutSeconds}` +
    `&allowed_updates=${encodeURIComponent(JSON.stringify(resolveTelegramAllowedUpdates()))}`;
  const response = await fetchFn(url, { method: "GET", signal: abortSignal });
  if (!response.ok) {
    throw new Error(`Telegram getUpdates failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { ok: boolean; result?: unknown; description?: string };
  if (body.ok !== true || !Array.isArray(body.result)) {
    throw new Error(`Telegram getUpdates failed: ${body.description ?? "malformed response"}`);
  }
  return body.result as TelegramUpdateShape[];
}

/**
 * Silent `answerCallbackQuery` — the click's ack (E2, the mirror of the Slack
 * half's envelope `ack()`): it clears the client's loading spinner and, with
 * no text/alert, carries no user-visible outcome (the hub-side card update is
 * the outcome). Best-effort: a fault is logged, never thrown — the click is
 * still handed to the seam (P13: one click must not kill the poll).
 */
async function answerCallbackQuery(
  opts: TelegramPollOptions,
  callbackQueryId: string,
): Promise<void> {
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const url = `${opts.apiRoot}/bot${encodeURIComponent(opts.botToken)}/answerCallbackQuery`;
  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `callback_query_id=${encodeURIComponent(callbackQueryId)}`,
    });
    if (!response.ok) {
      opts.logger?.warn("telegram answerCallbackQuery failed (click still dispatched)", {
        accountId: opts.accountId,
        status: response.status,
      });
    }
  } catch (error) {
    opts.logger?.warn("telegram answerCallbackQuery fault (click still dispatched)", {
      accountId: opts.accountId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** COMPAT(clisbot-control-plane): one approval-card click (E2) — ack FIRST
 * (the redelivery guard: an unacked `callback_query` is redelivered by the
 * Bot API on the next getUpdates), then hand the raw update to the seam when
 * one is wired. A faulty callback must not wedge the poll (mirror of Slack's
 * "kept socket alive"): the ack already fired. */
async function dispatchApprovalCallback(
  opts: TelegramPollOptions,
  callbackQuery: TelegramCallbackQueryShape,
): Promise<void> {
  await answerCallbackQuery(opts, callbackQuery.id);
  if (opts.onApprovalCallback === undefined) return;
  try {
    await opts.onApprovalCallback(callbackQuery);
  } catch (error) {
    opts.logger?.warn("telegram approval-callback handoff fault (kept polling)", {
      accountId: opts.accountId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
  // Group G: a media message's text is its caption; a caption with a mention
  // must steer exactly like `text` does.
  const text = messageBodyText(message);
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

/** The message body the L2 normalizes: `text` when present, else the media
 * caption (group G), else `""`. */
export function messageBodyText(message: TelegramMessageShape): string {
  if (typeof message.text === "string") return message.text;
  if (typeof message.caption === "string") return message.caption;
  return "";
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
  const text = messageBodyText(message);
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
      abortSignal: opts.abortSignal,
      fetchImpl: opts.fetchImpl,
    });
  } catch (error) {
    // Shutdown aborts the in-flight long poll. Treat that as the normal end
    // of the account lifetime, not as a transport failure.
    if (opts.abortSignal.aborted) return [];
    opts.logger?.warn("telegram poll fault (kept polling)", {
      accountId: opts.accountId,
      error: error instanceof Error ? error.message : String(error),
    });
    await abortableSleep(TELEGRAM_POLL_RETRY_DELAY_MS, opts.abortSignal);
    return null;
  }
}

/** Build the media download context for a dispatch and fold one event's
 * media into it; `null` when the fold leaves nothing to admit. */
async function foldBatchEvent(
  opts: TelegramPollOptions,
  update: TelegramUpdateShape,
  event: ChannelInboundEvent,
): Promise<ChannelInboundEvent | null> {
  const picked = pickMessage(update);
  if (picked === null) return event;
  return foldInboundTelegramMedia(
    {
      accountId: opts.accountId,
      botToken: opts.botToken,
      apiRoot: opts.apiRoot,
      downloadDir: opts.downloadDir!,
      abortSignal: opts.abortSignal,
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
    },
    picked.message,
    event,
  );
}

/** Hand a batch's updates to the processor + the approval seam (both swallow
 * handoff faults) and report the max update id seen. `seenUpdateIds` is the
 * transport-level redelivery guard for the offset-persist gap: when an offset
 * persist fails, the next poll re-serves the same updates from the same
 * offset — the vertical must not dispatch a re-served `callback_query` twice
 * (the hub's exactly-once latch is the second line), and remembering every
 * update id keeps a re-served message from re-entering L3 inside that window
 * too. */
async function dispatchBatch(
  opts: TelegramPollOptions,
  updates: TelegramUpdateShape[],
  seenUpdateIds: Set<number>,
): Promise<number> {
  let maxUpdateId = 0;
  for (const update of updates) {
    if (update.update_id === undefined || !Number.isSafeInteger(update.update_id)) continue;
    if (update.update_id > maxUpdateId) maxUpdateId = update.update_id;
    if (seenUpdateIds.has(update.update_id)) continue;
    seenUpdateIds.add(update.update_id);
    // E2: a card click is not a message — ack it and hand it to the seam.
    if (update.callback_query !== undefined) {
      await dispatchApprovalCallback(opts, update.callback_query);
      continue;
    }
    const event = normalizeTelegramInboundEvent(update, {
      accountId: opts.accountId,
      botId: opts.botId,
      ...(opts.botUsername !== undefined ? { botUsername: opts.botUsername } : {}),
    });
    if (event === null) continue;
    // Group G: fold inbound media into the event body (download + manifest).
    // Skipped entirely without a download dir (caption-only floor).
    const folded =
      opts.downloadDir !== undefined ? await foldBatchEvent(opts, update, event) : event;
    if (folded === null) continue;
    try {
      await opts.onEvent(folded);
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
  // Transport-level redelivery guard (see dispatchBatch): capped so the set
  // cannot outgrow the poll's lifetime; L3's event-id set + ledger stay the
  // durable dedupe.
  const seenUpdateIds = new Set<number>();
  const SEEN_UPDATE_IDS_CAP = 8192;
  for (;;) {
    if (opts.abortSignal.aborted) return;
    const batch = await fetchBatch(opts, effectiveOffset);
    if (batch === null) continue;
    const maxUpdateId = await dispatchBatch(opts, batch, seenUpdateIds);
    if (seenUpdateIds.size > SEEN_UPDATE_IDS_CAP) seenUpdateIds.clear();
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
