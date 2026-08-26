// The host-supplied Telegram monitor (pinned-vertical-contracts/telegram-monitor.md,
// option A — user-decided). The bundled Telegram vertical's import closure is
// alias-free (zero `openclaw/plugin-sdk/*` specifiers), so the loader seam
// cannot intercept its inbound dispatch: driving the inlined default monitor
// would answer channel messages with OpenClaw's own agent loop (plan §7
// excludes it). Instead the Hub installs THIS monitor as the native
// `monitorTelegramProvider` override (read site `channel-DP5CkqKN.js:555-556`)
// through the plugin runtime store that `entry.setChannelRuntime(hostRuntime)`
// fills — `hostRuntime.channel["telegram"]["monitorTelegramProvider"]`.
//
// The native `startAccount` (start-account.md) runs its own probe + bot-info
// cache BEFORE handing off, so the monitor receives a verified `botInfo` +
// `token`. The monitor owns `getUpdates` long-polling (direct fetch, no
// grammy), persists the poll offset in the keyed-store seam, dedupes in-flight
// update ids, builds the flat `ctxPayload` (inbound.md), and hands each message
// to `hostRuntime.onInboundReply` — the plane. Replies are posted by the Hub
// relay's PostFn through `plugin.outbound.sendText` (outbound.md); the monitor
// never posts. The promise resolves only on `abortSignal` (the native
// `waitForAbortSignal` contract); a fatal provider error (401/403/4xx) rejects
// and fails the account (P13). No SQLite: the native offset path lives in the
// native monitor and never loads.

import type { HostChildLogger, HostRuntime, InboundReplyParams } from "../host.js";
import type { PlaneLogger } from "../../plane/types.js";

/** The native monitor's call options (`resolveTelegramMonitor()({...})` —
 * start-account.md: the Hub replaces the function, not its argument shape). */
interface NativeMonitorOptions {
  token?: string;
  accountId?: string;
  config?: Record<string, unknown>;
  runtime?: unknown;
  channelRuntime?: unknown;
  abortSignal?: AbortSignal;
  useWebhook?: boolean;
  botInfo?: { id?: number; username?: string } | null;
  setStatus?: (status: string) => void;
}

/** The Telegram Bot API chat of an inbound message. */
interface TelegramChat {
  id: number;
  type?: string;
  title?: string;
  username?: string;
}

/** The Telegram Bot API user of an inbound sender. */
interface TelegramSender {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

/** An inbound `message` update (the fields the monitor reads). */
interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramSender;
  text?: string;
  caption?: string;
  date?: number;
  message_thread_id?: number;
  entities?: { type?: string; offset?: number; length?: number; user?: { id?: number } }[];
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface GetUpdatesResponse {
  ok: boolean;
  result?: TelegramUpdate[];
  description?: string;
  parameters?: { retry_after?: number };
}

/** The flat `ctxPayload` the plane's normalizer reads (inbound.md — exact
 * field names; `ChatType` is the native kind, `MessageThreadId` the topic id). */
function buildCtxPayload(params: {
  accountId: string;
  message: TelegramMessage;
  botUsername: string | undefined;
  botId: number | undefined;
}): Record<string, unknown> {
  const message = params.message;
  const chatId = String(message.chat.id);
  const sender = message.from;
  const threadId =
    typeof message.message_thread_id === "number" ? String(message.message_thread_id) : undefined;
  const text = message.text ?? message.caption ?? "";
  return {
    Body: text,
    BodyForAgent: text,
    ChatType: message.chat.type === "private" ? "direct" : "group",
    ChatId: chatId,
    ConversationLabel: message.chat.title ?? sender?.username ?? sender?.first_name ?? chatId,
    From: sender !== undefined ? String(sender.id) : "",
    To: chatId,
    MessageSid: String(message.message_id),
    Timestamp: (message.date ?? 0) * 1000,
    ...(sender !== undefined ? { SenderId: String(sender.id) } : {}),
    ...(sender?.first_name !== undefined ? { SenderName: sender.first_name } : {}),
    ...(sender?.username !== undefined ? { SenderUsername: sender.username } : {}),
    WasMentioned: wasMentioned(message, params.botUsername, params.botId),
    ...(threadId !== undefined ? { MessageThreadId: threadId } : {}),
    NativeChannelId: chatId,
    CommandAuthorized: false,
    AccountId: params.accountId,
    OriginatingChannel: "telegram",
    OriginatingTo: chatId,
  };
}

/** True when the bot is addressed: a DM is direct; a group needs a mention
 * entity naming the bot (the Bot API's own parse: `user.id` for user mentions,
 * the `@username` span for text mentions). */
function wasMentioned(
  message: TelegramMessage,
  botUsername: string | undefined,
  botId: number | undefined,
): boolean {
  if (message.chat.type === "private") return true;
  const text = message.text ?? message.caption ?? "";
  for (const entity of message.entities ?? []) {
    if (entity.type !== "mention") continue;
    if (botId !== undefined && entity.user?.id === botId) return true;
    if (
      botUsername !== undefined &&
      typeof entity.offset === "number" &&
      typeof entity.length === "number"
    ) {
      return text.slice(entity.offset, entity.offset + entity.length) === `@${botUsername}`;
    }
  }
  return false;
}

/** The poll offset store — the native `telegram.update-offsets` seam
 * (keyed-store.ts). The runtime root is already per-account; the caller keys
 * entries by account id. No TTL. */
function openOffsetStore(hostRuntime: HostRuntime) {
  return hostRuntime.state.openKeyedStore({
    namespace: "telegram.update-offsets",
    maxEntries: 1000,
  });
}

/** The host Telegram monitor. Resolves on `abortSignal`; rejects on a fatal
 * provider fault (P13). Never posts — the relay's PostFn owns outbound. */
export function startHostTelegramMonitor(params: {
  hostRuntime: HostRuntime;
  accountId: string;
  /** The native monitor's options (see `NativeMonitorOptions`). */
  options: Record<string, unknown>;
  /** The supervisor's plane logger (fault attribution). */
  logger: PlaneLogger;
}): Promise<void> {
  const { hostRuntime, accountId, options, logger } = params;
  const native = options as unknown as NativeMonitorOptions;
  const log: HostChildLogger = hostRuntime.logging.getChildLogger({
    op: "telegram-monitor",
    account: accountId,
  });
  const token = typeof native.token === "string" ? native.token.trim() : "";
  if (token === "") {
    throw new Error("the host Telegram monitor was driven without a bot token");
  }
  if (native.useWebhook === true) {
    throw new Error("the host Telegram monitor supports long-polling only (P0 transport mode)");
  }
  const signal: AbortSignal =
    native.abortSignal instanceof AbortSignal ? native.abortSignal : new AbortController().signal;
  const apiRoot = resolveApiRoot(native.config, accountId);
  const botUsername =
    typeof native.botInfo?.username === "string" ? native.botInfo.username : undefined;
  const botInfoId = typeof native.botInfo?.id === "number" ? native.botInfo.id : undefined;
  try {
    native.setStatus?.("polling");
  } catch {
    // Status is cosmetic; a setStatus fault is not a monitor fault.
  }

  // The drive: the long-poll loop, in an async closure so the validation
  // above stays a sync throw (a monitor driven without a token faults before
  // the promise even exists).
  return run();

  async function run(): Promise<void> {
    // In-flight dedupe (the offset persistence covers restarts; this covers
    // the in-flight poll window). A plain Set, cleared wholesale when it
    // overflows.
    const seenUpdateIds = new Set<number>();
    const offsetStore = openOffsetStore(hostRuntime);

    async function pollOnce(): Promise<number> {
      const lastOffset = (await offsetStore.lookup(accountId)) ?? 0;
      const offset = typeof lastOffset === "number" ? lastOffset : 0;
      const url =
        `${apiRoot}/bot${encodeURIComponent(token)}/getUpdates` +
        `?offset=${offset + 1}&timeout=30&allowed_updates=${encodeURIComponent(JSON.stringify(["message"]))}`;
      const response = await fetch(url, { signal });
      if (!response.ok) {
        const body = await safeJson<GetUpdatesResponse>(response);
        if (response.status === 429) {
          // Respect the provider's backoff, then retry.
          const retryAfter = body?.parameters?.retry_after ?? 3;
          await sleep(retryAfter * 1000, signal);
          return offset;
        }
        if (response.status >= 400 && response.status < 500) {
          throw new Error(
            `telegram getUpdates failed (${response.status}): ${body?.description ?? response.statusText}`,
          );
        }
        // 5xx: transient — back off and retry.
        await sleep(5000, signal);
        return offset;
      }
      const parsed = (await safeJson<GetUpdatesResponse>(response)) as GetUpdatesResponse;
      let highest = offset;
      for (const update of parsed.result ?? []) {
        if (typeof update.update_id !== "number") continue;
        if (update.update_id <= highest) continue; // already processed (dedupe)
        if (seenUpdateIds.has(update.update_id)) continue;
        seenUpdateIds.add(update.update_id);
        if (seenUpdateIds.size > 4096) seenUpdateIds.clear();
        highest = update.update_id;
        if (update.message === undefined) continue;
        await deliver(update.message, botUsername, botInfoId, log, logger, accountId);
      }
      if (highest > offset) await offsetStore.register(accountId, highest);
      return highest;
    }

    async function deliver(
      message: TelegramMessage,
      username: string | undefined,
      botId: number | undefined,
      monitorLog: HostChildLogger,
      planeLogger: PlaneLogger,
      accountIdParam: string,
    ): Promise<void> {
      // Own messages: the Hub relay posts the replies — re-ingesting them would
      // loop. The external-sender role (live E2E) is a DIFFERENT bot and is kept.
      if (botId !== undefined && message.from?.id === botId) return;
      const ctxPayload = buildCtxPayload({
        accountId: accountIdParam,
        message,
        botUsername: username,
        botId,
      });
      if (typeof ctxPayload["Body"] !== "string" || ctxPayload["Body"] === "") return; // media-only
      const inbound: InboundReplyParams = {
        channel: "telegram",
        accountId: accountIdParam,
        ctxPayload,
      };
      try {
        await hostRuntime.onInboundReply(inbound);
      } catch (error) {
        // The plane seam already catches; a throw here is a host fault — log,
        // keep polling (P13: one message's fault never kills the monitor).
        monitorLog.warn("telegram monitor inbound dispatch fault", {
          messageId: message.message_id,
          error: error instanceof Error ? error.message : String(error),
        });
        planeLogger.warn("channel monitor inbound failed", {
          channel: "telegram",
          account: accountIdParam,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // The long-poll loop: runs until `signal` aborts (resolve — the native
    // lifecycle) or a 4xx faults (reject — P13 account failure).
    for (;;) {
      if (signal.aborted) return;
      try {
        await pollOnce();
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof Error && error.name === "AbortError") return;
        // fetch rejects on network faults: transient — back off, never reject.
        const transient =
          error instanceof TypeError || // fetch network error
          (error instanceof Error && !/getUpdates failed \(/.test(error.message));
        if (transient) {
          await sleep(5000, signal);
          continue;
        }
        throw error;
      }
    }
  }
}

/** The Bot API root: the account's `apiRoot` config when present, else the
 * public API (tests point it at a local server). */
function resolveApiRoot(config: Record<string, unknown> | undefined, accountId: string): string {
  try {
    const channels = config?.["channels"] as Record<string, unknown> | undefined;
    const telegram = channels?.["telegram"] as Record<string, unknown> | undefined;
    const accounts = telegram?.["accounts"] as Record<string, { apiRoot?: unknown }> | undefined;
    const apiRoot = accounts?.[accountId]?.apiRoot;
    if (typeof apiRoot === "string" && apiRoot !== "") return apiRoot.replace(/\/+$/u, "");
  } catch {
    // Malformed config falls back to the public API (the provider will reject
    // with a clear 4xx if the token is wrong).
  }
  return "https://api.telegram.org";
}

async function safeJson<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

/** Sleep that ends early on abort (resolves, the loop's `signal.aborted`
 * check then exits). A timer race against the abort event: each side
 * resolves its own promise once, and the loser is torn down afterwards. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  // The winning side tears the loser down (clears the timer, detaches the
  // abort listener) before resolving — no dangling handle on the signal.
  const settle = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  };
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      settle();
      resolve();
    }, ms);
  });
  const aborted = new Promise<void>((resolve) => {
    onAbort = () => {
      settle();
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([timeout, aborted]);
}
