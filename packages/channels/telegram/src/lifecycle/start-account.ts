// L4 account lifecycle (blueprint §6.5 L4, start-account.md): resolve the
// token, probe getMe, cache the bot info in the plane's keyed-store seam,
// run the duplicate-token guard across the configured accounts, then hand
// off to the transport. The startAccount promise resolves only when
// `ctx.abortSignal` fires — "start" is the transport lifetime.
//
// Slice 20 swapped the transport: the hand-rolled `transport/poll.ts` fetch loop
// is retired and the account now polls (or, when a public URL is configured,
// receives) through a grammY 1.46.0 client — the same SDK at the same version
// upstream uses. `fusion/polling-session.ts` owns the loop and keeps the Fusion
// invariant (durable admission before the offset watermark advances);
// `fusion/webhook-session.ts` owns the webhook mode.

import type {
  ChannelInboundEvent,
  HostRuntime,
  StartAccountContext,
} from "@getpaseo/channels-shared";
import {
  buildTelegramClientOptions,
  createTelegramApi,
  openTelegramSeamStores,
  resolveTelegramAccount,
  type TelegramBotInfo,
  type TelegramCfg,
} from "../client/bot-api.js";
import { registerAccountInbound, unregisterAccountInbound } from "../runtime-store.js";
import { withTelegramAccount } from "../runtime.js";
import {
  approvalCallbackRootKind,
  parseApprovalCallbackClick,
  type TelegramCallbackQueryShape,
} from "../transport/approval-callback.js";
import { fingerprintTelegramBotToken } from "../token-fingerprint.js";
import { TelegramPollingSession } from "../fusion/polling-session.js";
import {
  resolveTelegramWebhookMode,
  startTelegramWebhookSession,
} from "../fusion/webhook-session.js";
import { buildTelegramAdmission } from "../fusion/admission.js";
import type { CallbackQuery } from "grammy/types";

export const TELEGRAM_BOT_INFO_CACHE_TTL_MS = 86_400_000;

const activeBotPollers = new Map<number, string>();

export function claimTelegramBotPoller(botId: number, accountId: string): () => void {
  const owner = activeBotPollers.get(botId);
  if (owner !== undefined) {
    throw new Error(
      `Telegram bot ${botId} is already polled by account "${owner}"; one Bot API token may have only one active poller`,
    );
  }
  activeBotPollers.set(botId, accountId);
  return () => {
    if (activeBotPollers.get(botId) === accountId) activeBotPollers.delete(botId);
  };
}

export interface TelegramBotInfoCacheState {
  tokenFingerprint: string;
  fetchedAt: number;
  bot: TelegramBotInfo;
}

/** The token fingerprint persisted in the offset + bot-info stores (never
 * the token itself) — rotation detection without storing the secret. */
export function telegramTokenFingerprint(token: string): string {
  return fingerprintTelegramBotToken(token);
}

/** The bot-info cache seam read: valid entry for THIS token within TTL, else
 * `null` (forces a fresh getMe probe). */
export async function readBotInfoCache(
  hostRuntime: HostRuntime,
  accountId: string,
  token: string,
  now?: number,
): Promise<TelegramBotInfoCacheState | null> {
  const store = openTelegramSeamStores(hostRuntime).botInfoCache;
  const stored = await store.lookup(accountId).catch(() => undefined);
  if (stored === undefined) return null;
  const fingerprint = telegramTokenFingerprint(token);
  if (stored.tokenFingerprint !== fingerprint) return null;
  const fetchedAt = stored.fetchedAt;
  const nowMs = now ?? Date.now();
  if (!Number.isFinite(fetchedAt) || nowMs - fetchedAt > TELEGRAM_BOT_INFO_CACHE_TTL_MS) {
    return null;
  }
  return stored;
}

/** The bot-info cache seam write (after a successful probe). */
export async function writeBotInfoCache(
  hostRuntime: HostRuntime,
  accountId: string,
  token: string,
  bot: TelegramBotInfo,
): Promise<void> {
  const store = openTelegramSeamStores(hostRuntime).botInfoCache;
  await store.register(accountId, {
    tokenFingerprint: telegramTokenFingerprint(token),
    fetchedAt: Date.now(),
    bot,
  });
}

/** The probe limiter (startup-probe-limiter.ts, module-level port): at most
 * two getMe probes run concurrently; later probes queue with abort. */
const TELEGRAM_STARTUP_PROBE_CONCURRENCY = 2;
let activeProbes = 0;
const probeWaiters: Array<() => void> = [];

export async function withTelegramStartupProbeSlot<T>(
  abortSignal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (abortSignal?.aborted === true) throw new Error("telegram startup probe aborted");
  if (activeProbes >= TELEGRAM_STARTUP_PROBE_CONCURRENCY) {
    await new Promise<void>((resolve) => {
      if (abortSignal?.aborted === true) {
        resolve();
        return;
      }
      probeWaiters.push(resolve);
      const onAbort = () => {
        const index = probeWaiters.indexOf(resolve);
        if (index >= 0) probeWaiters.splice(index, 1);
        resolve();
      };
      abortSignal?.addEventListener("abort", onAbort, { once: true });
    });
    if (abortSignal?.aborted) throw new Error("telegram startup probe aborted");
  }
  activeProbes += 1;
  try {
    return await run();
  } finally {
    activeProbes -= 1;
    const next = probeWaiters.shift();
    if (next !== undefined) next();
  }
}

/** The getMe probe through the L1 client (throttler-aware, timeout-aware). */
export async function probeTelegramBotInfo(
  token: string,
  cfg: TelegramCfg,
  accountId: string,
  hostRuntime: HostRuntime,
  abortSignal?: AbortSignal,
): Promise<TelegramBotInfo> {
  const account = resolveTelegramAccount(cfg, accountId, { token });
  const api = await createTelegramApi(token, buildTelegramClientOptions(account));
  return withTelegramStartupProbeSlot(abortSignal, () => api.getMe());
}

/** Duplicate-token guard (start-account.md): scan every configured account;
 * the same token under two ids fails at drive time (one poller per token —
 * Telegram allows a single getUpdates consumer per bot). Blank tokens are
 * skipped, not collisions. */
export function assertNoDuplicateTelegramTokens(cfg: TelegramCfg, activeAccountId: string): void {
  void activeAccountId;
  const accounts = telegramConfiguredAccounts(cfg);
  // Every pair, not each account against the first one that had a token:
  // `a=X, b=Y, c=Y` shares a token between `b` and `c`, and a single-owner scan
  // walks past it.
  const owners = new Map<string, string>(); // token → first accountId holding it
  for (const [accountId, token] of accounts) {
    const trimmed = token === null ? "" : token.trim();
    if (trimmed === "") continue;
    const owner = owners.get(trimmed);
    if (owner !== undefined) {
      throw new Error(duplicateTokenMessage(owner, accountId));
    }
    owners.set(trimmed, accountId);
  }
}

function duplicateTokenMessage(owner: string, other: string): string {
  return `duplicate Telegram bot token configured for accounts "${owner}" and "${other}" — one bot token may serve one account (Telegram allows a single poller per bot). Remove the stray account entry.`;
}

function telegramConfiguredAccounts(cfg: TelegramCfg): Array<[string, string | null]> {
  const channels = cfg["channels"] as Record<string, unknown> | undefined;
  const telegram = channels?.["telegram"] as Record<string, unknown> | undefined;
  const accounts = telegram?.["accounts"] as Record<string, Record<string, unknown>> | undefined;
  if (accounts === undefined) return [];
  return Object.entries(accounts).map(([accountId, entry]) => [
    accountId,
    typeof entry?.["botToken"] === "string" ? entry["botToken"] : null,
  ]);
}

/** Group G: the account's inbound-media download dir (`<dataDir>/channels/<accountId>/downloads`,
 * filled by the Hub supervisor as `ctx.mediaDownloadDir`). `undefined` → the L2 poll skips
 * media downloads (caption/text-only bodies), the unit-test floor. */
function resolveMediaDownloadDir(ctx: StartAccountContext): string | undefined {
  return typeof ctx.mediaDownloadDir === "string" && ctx.mediaDownloadDir !== ""
    ? ctx.mediaDownloadDir
    : undefined;
}

/** `plugin.gateway.startAccount` — the drive surface entry. Resolves on
 * abort (D2). Steps: token → probe (cached) → duplicate guard → L2 poll. */
export async function startTelegramAccount(
  ctx: StartAccountContext,
  hostRuntime: HostRuntime,
): Promise<void> {
  const log = ctx.log;
  const cfg = ctx.cfg as unknown as TelegramCfg;
  const { accountId, abortSignal } = ctx;
  if (cfg === undefined || cfg === null) {
    throw new Error("telegram startAccount requires a runtime config (ctx.cfg)");
  }
  assertNoDuplicateTelegramTokens(cfg, accountId);
  const account = resolveTelegramAccount(cfg, accountId, ctx.account);
  const cached = await readBotInfoCache(hostRuntime, accountId, account.token);
  const botInfo: TelegramBotInfo =
    cached?.bot !== undefined
      ? cached.bot
      : await probeTelegramBotInfo(account.token, cfg, accountId, hostRuntime, abortSignal);
  if (typeof botInfo.id !== "number") {
    throw new Error("telegram getMe probe returned no bot id");
  }
  await writeBotInfoCache(hostRuntime, accountId, account.token, botInfo);
  const releasePoller = claimTelegramBotPoller(botInfo.id, accountId);
  let inbound: ReturnType<typeof registerAccountInbound>;
  try {
    inbound = registerAccountInbound(accountId, botInfo.id, hostRuntime);
  } catch (error) {
    releasePoller();
    throw error;
  }
  log?.info?.("telegram account started", { accountId, botId: botInfo.id });
  ctx.setStatus({
    state: "polling",
    accountId,
    botId: botInfo.id,
    botUsername: botInfo.username ?? null,
  });
  const downloadDir = resolveMediaDownloadDir(ctx);
  // COMPAT(clisbot-control-plane): the approval card's button-click seam (E2
  // — the mirror of the Slack vertical's `onInteractive`). The Hub supervisor
  // mounts `channelRuntime.approvalAction` (the plane's onApprovalCallback,
  // the SAME exactly-once resolver as a typed command — the click is data,
  // never authority). Absent (unit posture, pinned vertical) = no card
  // clicks; the typed command still answers the prompt.
  const onApprovalCallback = telegramApprovalCallback(ctx.channelRuntime, accountId);
  const apiRoot = account.config.apiRoot?.trim() || "https://api.telegram.org";
  const api = await createTelegramApi(account.token, buildTelegramClientOptions(account));
  const admit = buildTelegramAdmission({
    accountId,
    botToken: account.token,
    apiRoot,
    abortSignal,
    ...(downloadDir !== undefined ? { downloadDir } : {}),
    ...(log !== undefined ? { logger: log } : {}),
    botId: botInfo.id,
    handleInbound: (event: ChannelInboundEvent) => inbound.handleInbound(event),
  });
  const sessionOptions = {
    accountId,
    botToken: account.token,
    api,
    botId: botInfo.id,
    ...(botInfo.username !== undefined ? { botUsername: botInfo.username } : {}),
    abortSignal,
    admit,
    ...(log !== undefined ? { logger: log } : {}),
    setStatus: (patch: Record<string, unknown>) => {
      ctx.setStatus({ ...patch, accountId } as never);
    },
    ...(onApprovalCallback !== undefined
      ? { onApprovalCallback: (query: CallbackQuery) => onApprovalCallback(query as never) }
      : {}),
  };
  try {
    // D-TG-046: the transport runs inside the account's runtime scope, so every
    // ported inbound store the session touches (update offset, message cache,
    // topic names) resolves THIS account through the upstream zero-arg
    // `getTelegramRuntime()`. Without the scope an account that never sent
    // would fail every offset persist with "Telegram runtime not initialized".
    await withTelegramAccount(accountId, async () => {
      const webhook = resolveTelegramWebhookMode(account.config);
      if (webhook !== null) {
        await startTelegramWebhookSession({ ...sessionOptions, webhook });
      } else {
        await new TelegramPollingSession(sessionOptions).runUntilAbort();
      }
    });
  } finally {
    unregisterAccountInbound(accountId, hostRuntime);
    releasePoller();
    ctx.setStatus({ state: "stopped", accountId });
  }
}

/**
 * COMPAT(clisbot-control-plane): the approval card's button-click seam (E2).
 * The Hub supervisor mounts `channelRuntime.approvalAction` (the plane's
 * onApprovalCallback, the SAME exactly-once resolver as a typed command —
 * the click is data, never authority). Absent (unit posture, pinned
 * vertical) = no card clicks; the typed command still answers the prompt.
 * L4 narrows the channel envelope only (approval-callback.ts); the card value
 * (`callback_data`) stays opaque to the vertical — the hub's card parser
 * owns its format. Returns undefined when no seam is wired.
 */
function telegramApprovalCallback(
  channelRuntime: Record<string, unknown> | undefined,
  accountId: string,
): ((callbackQuery: TelegramCallbackQueryShape) => Promise<void>) | undefined {
  const approvalAction = channelRuntime?.["approvalAction"];
  if (typeof approvalAction !== "function") return undefined;
  const invoke = approvalAction as (params: Record<string, unknown>) => Promise<unknown>;
  return async (callbackQuery): Promise<void> => {
    // The vertical parses the CHANNEL envelope only (who clicked, where the
    // card sits); the card value is opaque to the vertical — the hub's card
    // parser owns its format (one parse, hub-side).
    const click = parseApprovalCallbackClick(callbackQuery);
    if (click === null) return;
    await invoke({
      channel: "telegram",
      accountId,
      senderIdentity: `telegram:${click.senderId}`,
      cardValue: click.cardValue,
      externalConversationId: click.rootChatId,
      externalThreadId: click.threadId ?? null,
      rootKind: approvalCallbackRootKind(click.chatType),
    });
  };
}
