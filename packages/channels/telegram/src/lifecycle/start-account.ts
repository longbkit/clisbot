// L4 account lifecycle (blueprint §6.5 L4, start-account.md): resolve the
// token, probe getMe, cache the bot info in the plane's keyed-store seam,
// run the duplicate-token guard across the configured accounts, then hand
// off to the L2 poll transport. The startAccount promise resolves only when
// `ctx.abortSignal` fires — "start" is the transport lifetime.

import type { HostRuntime, StartAccountContext } from "@getpaseo/channels-shared";
import {
  buildTelegramClientOptions,
  createTelegramApi,
  openTelegramSeamStores,
  resolveTelegramAccount,
  type TelegramBotInfo,
  type TelegramCfg,
} from "../client/bot-api.js";
import { registerAccountInbound } from "../runtime-store.js";
import {
  approvalCallbackRootKind,
  parseApprovalCallbackClick,
  type TelegramCallbackQueryShape,
} from "../transport/approval-callback.js";
import { fingerprintTelegramBotToken, runTelegramPoll } from "../transport/poll.js";

export const TELEGRAM_BOT_INFO_CACHE_TTL_MS = 86_400_000;

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
  let owner: [string, string] | null = null; // [accountId, trimmedToken]
  for (const [accountId, token] of accounts) {
    const trimmed = token === null ? "" : token.trim();
    if (trimmed === "") continue;
    if (owner !== null && owner[1] === trimmed) {
      throw new Error(duplicateTokenMessage(owner[0], accountId));
    }
    if (owner === null) owner = [accountId, trimmed];
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
  const inbound = registerAccountInbound(accountId, botInfo.id);
  log?.info?.("telegram account started", { accountId, botId: botInfo.id });
  ctx.setStatus({
    state: "polling",
    accountId,
    botId: botInfo.id,
    botUsername: botInfo.username ?? null,
  });
  const updateOffsetStore = openTelegramSeamStores(hostRuntime).updateOffsets;
  const downloadDir = resolveMediaDownloadDir(ctx);
  // COMPAT(clisbot-control-plane): the approval card's button-click seam (E2
  // — the mirror of the Slack vertical's `onInteractive`). The Hub supervisor
  // mounts `channelRuntime.approvalAction` (the plane's onApprovalCallback,
  // the SAME exactly-once resolver as a typed command — the click is data,
  // never authority). Absent (unit posture, pinned vertical) = no card
  // clicks; the typed command still answers the prompt.
  const onApprovalCallback = telegramApprovalCallback(ctx.channelRuntime, accountId);
  await runTelegramPoll({
    accountId,
    botToken: account.token,
    apiRoot: account.config.apiRoot?.trim() || "https://api.telegram.org",
    botId: botInfo.id,
    ...(botInfo.username !== undefined ? { botUsername: botInfo.username } : {}),
    abortSignal,
    updateOffsetStore,
    ...(downloadDir !== undefined ? { downloadDir } : {}),
    ...(log !== undefined ? { logger: log } : {}),
    ...(onApprovalCallback !== undefined ? { onApprovalCallback } : {}),
    onEvent: async (event) => {
      // L3 dedupe/ledger/handoff: the shared processor this account registered.
      await inbound.handleInbound(event);
    },
  });
  ctx.setStatus({ state: "stopped", accountId });
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
