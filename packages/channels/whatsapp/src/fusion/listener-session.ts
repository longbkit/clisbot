// Fusion-owned L2 transport session (D-WA-024): upstream `auto-reply/monitor.ts`
// `monitorWebChannel`, without the agent.
//
// The reconnect owner is upstream's `WhatsAppConnectionController`, carried
// verbatim: socket open/close, heartbeat and watchdog timers, the close-reason
// normalization, the backoff policy and its non-retryable statuses (401 logged
// out, 440 session conflict). This loop drives it the way upstream's monitor
// does — open, wait for close, ask the controller what the close means, retry
// or stop — and reports each outcome through the Hub's account status instead
// of OpenClaw's status sink and system events.
//
// Omitted with the agent side of `monitorWebChannel`: the reply resolver,
// mention config, group history, the approval runtime context, the pending
// delivery drain (the Hub owns outbound retry) and the SIGINT hook (the Hub owns
// the process). The listener is `fusion/inbox.ts`.
//
// A logged-out device ends the session with an error that says "is not logged in",
// the phrase the Hub supervisor turns into `needs-login`: WhatsApp revoked the
// linked device, and only a new QR scan brings it back.
import type { WAMessageKey, WASocket } from "baileys";
import { formatErrorMessage } from "@clisbot/channels-core/plugin-sdk/error-runtime";
import type { ChannelInboundEvent, HostChildLogger, HostKeyedStore } from "@clisbot/channels-shared";
import type { StoredWhatsAppPoll } from "./polls.js";
import type { StoredReactionCard } from "./reaction-cards.js";
import { WhatsAppConnectionController } from "../connection-controller.js";
import { readWhatsAppBaileysCacheEntry, type WhatsAppBaileysGroupMetadataCache, type WhatsAppBaileysMessageCache } from "../inbound/baileys-cache.js";
import type { WhatsAppGroupMetadataCache } from "../inbound/group-metadata-cache.js";
import { newConnectionId, resolveHeartbeatSeconds, resolveReconnectPolicy } from "../reconnect.js";
import type { ResolvedWhatsAppAccount } from "../accounts.js";
import type { OpenClawConfig } from "@clisbot/channels-core/plugin-sdk/config-contracts";
import { resolveWhatsAppSocketTiming } from "../socket-timing.js";
import { attachWhatsAppInbox } from "./inbox.js";

const DEFAULT_TRANSPORT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MESSAGE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_WATCHDOG_CHECK_MS = 60 * 1000;

/** Upstream's only non-retryable close: 440, a conflicting WhatsApp Web session. */
function isNonRetryableWebCloseStatus(statusCode: unknown): boolean {
  return statusCode === 440;
}

export class WhatsAppNotLinkedError extends Error {
  constructor(accountId: string, detail: string) {
    super(`whatsapp account "${accountId}" is not logged in: ${detail}. Log in again by scanning the QR code.`);
    this.name = "WhatsAppNotLinkedError";
  }
}

/** What the account lifecycle can do to a running session (Unlink). */
export interface WhatsAppLiveSessionControl {
  getSock(): WASocket | null;
  /** Ends the session as WhatsApp logging the device out would. */
  forceLoggedOut(): void;
}

export interface WhatsAppListenerSessionOptions {
  cfg: OpenClawConfig;
  account: ResolvedWhatsAppAccount;
  admit: (event: ChannelInboundEvent) => Promise<unknown>;
  /** The account's poll store (`fusion/polls.ts`). */
  polls?: HostKeyedStore<StoredWhatsAppPoll>;
  /** The account's reaction-card store (`fusion/reaction-cards.ts`). */
  cards?: HostKeyedStore<StoredReactionCard>;
  mediaDownloadDir?: string;
  abortSignal: AbortSignal;
  logger?: HostChildLogger;
  setStatus?: (patch: Record<string, unknown>) => void;
  /** Receives the session's control once the controller exists. */
  onLive?: (control: WhatsAppLiveSessionControl) => void;
}

/** Runs until `abortSignal` fires (resolves) or the controller stops (rejects). */
export async function startWhatsAppListenerSession(
  options: WhatsAppListenerSessionOptions,
): Promise<void> {
  const { account, abortSignal, logger } = options;
  const accountId = account.accountId;
  const reconnectPolicy = resolveReconnectPolicy(options.cfg);
  const socketTiming = resolveWhatsAppSocketTiming();
  // Log out must stop the account whatever the loop is doing: connected, opening
  // a connection, or sleeping before a retry, when there is no socket to close.
  // Aborting this signal cuts all three, and the session then ends logged out.
  const logout = new AbortController();
  const signal = AbortSignal.any([abortSignal, logout.signal]);
  const loggedOut = () => logout.signal.aborted && !abortSignal.aborted;
  const controller = new WhatsAppConnectionController({
    accountId,
    authDir: account.authDir,
    verbose: false,
    keepAlive: true,
    heartbeatSeconds: resolveHeartbeatSeconds(options.cfg),
    transportTimeoutMs: DEFAULT_TRANSPORT_TIMEOUT_MS,
    messageTimeoutMs: DEFAULT_MESSAGE_TIMEOUT_MS,
    watchdogCheckMs: DEFAULT_WATCHDOG_CHECK_MS,
    reconnectPolicy,
    socketTiming,
    abortSignal: signal,
    isNonRetryableStatus: isNonRetryableWebCloseStatus,
  });
  options.onLive?.({
    getSock: () => controller.getCurrentSock(),
    forceLoggedOut: () => {
      logout.abort(new Error("logged out"));
      controller.forceClose({
        status: 401,
        isLoggedOut: true,
        error: new Error("the linked device was unlinked"),
      });
    },
  });
  const groupMetadataCache: WhatsAppGroupMetadataCache = new Map();
  const recentMessageKeys: WhatsAppBaileysMessageCache = new Map();
  const baileysGroupMetaCache: WhatsAppBaileysGroupMetadataCache = new Map();

  const createListener = ({ sock }: { sock: WASocket }) =>
    attachWhatsAppInbox({
      cfg: options.cfg,
      accountId,
      authDir: account.authDir,
      sock,
      socketRef: controller.socketRef,
      socketTiming,
      selfChatMode: account.selfChatMode,
      sendReadReceipts: account.sendReadReceipts,
      mediaMaxMb: account.mediaMaxMb,
      ...(options.mediaDownloadDir ? { mediaDownloadDir: options.mediaDownloadDir } : {}),
      shouldRetryDisconnect: () => controller.shouldRetryDisconnect(),
      disconnectRetryPolicy: reconnectPolicy,
      disconnectRetryAbortSignal: controller.getDisconnectRetryAbortSignal(),
      groupMetadataCache,
      recentMessageKeys,
      baileysGroupMetaCache,
      admit: options.admit,
      ...(options.polls ? { polls: options.polls } : {}),
      ...(options.cards ? { cards: options.cards } : {}),
      onInbound: (at) => {
        controller.noteInbound(at);
        options.setStatus?.({ lastInboundAt: at });
      },
      abortSignal: signal,
      ...(logger ? { logger } : {}),
    });

  try {
    while (!signal.aborted) {
      const connectionId = newConnectionId();
      try {
        await controller.openConnection({
          connectionId,
          getMessage: async (key: WAMessageKey) =>
            key.id && key.remoteJid
              ? readWhatsAppBaileysCacheEntry(recentMessageKeys, `${key.remoteJid}:${key.id}`)
              : undefined,
          cachedGroupMetadata: async (jid: string) => {
            const meta = readWhatsAppBaileysCacheEntry(baileysGroupMetaCache, jid);
            return meta?.participants?.length ? meta : undefined;
          },
          createListener,
          onWatchdogTimeout: () =>
            logger?.warn(`[${accountId}] WhatsApp watchdog timeout - restarting connection`),
        });
      } catch (error) {
        const decision = controller.resolveSetupErrorDecision(error);
        if (decision === "aborted") break;
        if (decision === null) throw error;
        if (decision.action === "stop") throw stopError(accountId, decision, formatErrorMessage(error));
        await reportRetry(options, decision.reconnectAttempts, decision.delayMs ?? 0, String(decision.normalized.statusLabel));
        await controller.waitBeforeRetry(decision.delayMs ?? 0);
        continue;
      }
      const self = controller.getSelfIdentity();
      options.setStatus?.({
        connected: true,
        lifecycle: "ready",
        lastConnectedAt: Date.now(),
        ...(self?.e164 ? { user: { userId: self.e164, displayName: self.e164 } } : {}),
      });
      logger?.info?.(`[${accountId}] WhatsApp connected${self?.e164 ? ` as ${self.e164}` : ""}`);

      const reason = await controller.waitForClose();
      if (signal.aborted || reason === "aborted") break;
      const decision = controller.resolveCloseDecision(reason);
      if (decision === "aborted") break;
      if (decision.action === "stop") {
        await controller.closeCurrentConnection();
        throw stopError(accountId, decision, decision.normalized.errorText);
      }
      await reportRetry(options, decision.reconnectAttempts, decision.delayMs ?? 0, String(decision.normalized.statusLabel));
      await controller.closeCurrentConnection();
      await controller.waitBeforeRetry(decision.delayMs ?? 0);
    }
  } catch (error) {
    // A sleep or a connect cut short by Log out throws its abort: that is the
    // logout itself, reported below, not a failure.
    if (!loggedOut()) throw error;
  } finally {
    await controller.shutdown();
  }
  // Ended by Log out rather than by the Hub stopping the account: the account
  // is no longer logged in, which the Hub turns into `needs-login`.
  if (loggedOut()) throw new WhatsAppNotLinkedError(accountId, "it was logged out");
}

function stopError(
  accountId: string,
  decision: { healthState: string; reconnectAttempts: number; normalized: { statusLabel: unknown } },
  detail: string,
): Error {
  if (decision.healthState === "logged-out") {
    return new WhatsAppNotLinkedError(accountId, "WhatsApp logged this linked device out");
  }
  if (decision.healthState === "conflict") {
    return new Error(
      `whatsapp account "${accountId}" closed: another WhatsApp Web session is using this link (status ${String(decision.normalized.statusLabel)}). Close the other session, then restart the Connection.`,
    );
  }
  return new Error(
    `whatsapp account "${accountId}" stopped after ${decision.reconnectAttempts} reconnect attempts (status ${String(decision.normalized.statusLabel)}): ${detail}`,
  );
}

async function reportRetry(
  options: WhatsAppListenerSessionOptions,
  attempt: number,
  delayMs: number,
  status: string,
): Promise<void> {
  options.setStatus?.({ connected: false, lifecycle: "recovering", reconnectAttempts: attempt });
  options.logger?.warn(
    `[${options.account.accountId}] WhatsApp connection closed (status ${status}); retry ${attempt} in ${delayMs} ms`,
  );
}
