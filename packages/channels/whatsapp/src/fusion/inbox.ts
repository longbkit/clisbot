// Fusion-owned inbox attach (D-WA-023): upstream `inbound/monitor.ts`
// `attachWebInboxToSocket`, with the delivery half replaced.
//
// Kept from upstream, in upstream's order: the attached socket session (send
// retry through reconnects, read receipts, LID→phone resolution, the Baileys
// message cache), the group-metadata owner (subjects, participants, outbound
// @mentions) and the web send API the active listener exposes to `send.ts`.
//
// Replaced: `inbound/message-delivery.ts` and the durable queue under it. Its
// job — admit, debounce, dispatch to the agent, approval/question reactions —
// is the Hub's. What remains here is the receive step upstream runs before its
// queue: skip stale reconnect catch-up, normalize, enrich (download media),
// then hand the event to the Hub and, once admitted, send the read receipt.
//
// Admission is the push-family rule (docs/features/channels/README.md, durable
// admission). Baileys acknowledges the protocol node before `messages.upsert`
// reaches us and the server does not redeliver it, so a message is retried in
// place and dropped with an error-level line only after its budget is spent.
// Upserts are handled one at a time so the Hub receives a chat in order.
//
// Added on the way (each is upstream's own data, kept where upstream kept it):
// every admitted message fills upstream's quoted-message cache
// (`cacheInboundMessageMeta`, as `message-delivery.ts` did) so an answer can
// quote it (`fusion/quotes.ts`, D-WA-031); polls are remembered and votes become
// `poll_answer` events (`fusion/poll-intake.ts`, D-WA-030); a reaction on an
// approval or question prompt answers it (`fusion/card-intake.ts`, D-WA-032).
import type { WAMessage, WASocket } from "baileys";
import { formatErrorMessage } from "@clisbot/channels-core/plugin-sdk/error-runtime";
import { sleep } from "@clisbot/channels-core/plugin-sdk/text-utility-runtime";
import type { ChannelInboundEvent, HostChildLogger, HostKeyedStore } from "@clisbot/channels-shared";
import type { WhatsAppBaileysGroupMetadataCache, WhatsAppBaileysMessageCache } from "../inbound/baileys-cache.js";
import {
  createWhatsAppGroupMetadataCacheOwner,
  type WhatsAppGroupMetadataCache,
} from "../inbound/group-metadata-cache.js";
import { enrichWhatsAppInboundMessage } from "../inbound/message-enrichment.js";
import { createWhatsAppInboundMessageNormalizer } from "../inbound/message-normalization.js";
import { createWebSendApi } from "../inbound/send-api.js";
import { createWhatsAppAttachedSocketSession } from "../inbound/socket-session.js";
import type { ManagedWhatsAppListener } from "../connection-controller.js";
import type { OpenClawConfig } from "@clisbot/channels-core/plugin-sdk/config-contracts";
import type { WhatsAppSocketTimingOptions } from "../socket-timing.js";
import { cacheInboundMessageMeta } from "../quoted-message.js";
import type { WhatsAppEnrichedInboundMessage } from "../inbound/message-enrichment.js";
import type { WhatsAppNormalizedInboundMessage } from "../inbound/message-normalization.js";
import { createWhatsAppCardIntake } from "./card-intake.js";
import { createWhatsAppPollIntake } from "./poll-intake.js";
import type { StoredReactionCard } from "./reaction-cards.js";
import type { StoredWhatsAppPoll } from "./polls.js";
import { noteWhatsAppInboundForQuote } from "./quotes.js";
import { buildWhatsAppInboundEvent } from "./inbound-adapter.js";
import { fileSizeOrZero, withWhatsAppMediaDownloadDir } from "./media-store.js";

/** Admission attempts one message gets before the session drops it. */
export const WHATSAPP_ADMISSION_MAX_ATTEMPTS = 5;
/** Backoff between admission attempts for the same message. */
export const WHATSAPP_ADMISSION_RETRY_DELAY_MS = 500;
/** Upstream's grace for `append` upserts that arrive just after connect. */
const APPEND_RECENT_GRACE_MS = 60_000;

export interface WhatsAppInboxOptions {
  cfg: OpenClawConfig;
  accountId: string;
  authDir: string;
  sock: WASocket;
  socketRef: { current: WASocket | null };
  socketTiming: Required<WhatsAppSocketTimingOptions>;
  selfChatMode?: boolean;
  sendReadReceipts?: boolean;
  mediaMaxMb?: number;
  /** Where inbound media is saved (the Hub's per-account download dir). */
  mediaDownloadDir?: string;
  shouldRetryDisconnect: () => boolean;
  disconnectRetryPolicy: { initialMs: number; maxMs: number; factor: number; jitter: number; maxAttempts: number };
  disconnectRetryAbortSignal: AbortSignal;
  groupMetadataCache: WhatsAppGroupMetadataCache;
  recentMessageKeys: WhatsAppBaileysMessageCache;
  baileysGroupMetaCache: WhatsAppBaileysGroupMetadataCache;
  admit: (event: ChannelInboundEvent) => Promise<unknown>;
  /** The account's poll store; without it votes are not decoded. */
  polls?: HostKeyedStore<StoredWhatsAppPoll>;
  /** The account's reaction-card store; without it reactions answer nothing. */
  cards?: HostKeyedStore<StoredReactionCard>;
  onInbound?: (at: number) => void;
  abortSignal: AbortSignal;
  logger?: HostChildLogger;
}

function parseTimestampSeconds(value: unknown): number | undefined {
  if (value == null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function attachWhatsAppInbox(
  options: WhatsAppInboxOptions,
): Promise<ManagedWhatsAppListener> {
  const { logger, accountId } = options;
  const logVerbose = (message: string) => logger?.debug?.(`[${accountId}] ${message}`);
  const socketSession = await createWhatsAppAttachedSocketSession({
    sock: options.sock,
    socketRef: options.socketRef,
    accountId,
    authDir: options.authDir,
    selfChatMode: options.selfChatMode,
    socketTiming: options.socketTiming,
    shouldRetryDisconnect: options.shouldRetryDisconnect,
    disconnectRetryPolicy: options.disconnectRetryPolicy,
    disconnectRetryAbortSignal: options.disconnectRetryAbortSignal,
    recentMessageKeys: options.recentMessageKeys,
    logVerbose,
    logConnectionError: (error) =>
      logger?.error?.(`[${accountId}] WhatsApp connection.update handler error: ${String(error)}`),
  });
  const groupMetadata = createWhatsAppGroupMetadataCacheOwner({
    sock: options.sock,
    getCurrentSock: socketSession.getCurrentSock,
    resolveInboundJid: socketSession.resolveInboundJid,
    reconnectCache: options.groupMetadataCache,
    baileysCache: options.baileysGroupMetaCache,
    listen: socketSession.listen,
    logVerbose,
    logHydrationWarning: (error) =>
      logger?.warn(`[${accountId}] failed hydrating WhatsApp groups on connect: ${String(error)}`),
  });
  const normalizer = createWhatsAppInboundMessageNormalizer({
    cfg: options.cfg,
    accountId,
    verbose: false,
    socketSession,
    groupMetadata,
    parseTimestampSeconds,
    logVerbose,
  });
  const sendApi = createWebSendApi({
    sock: socketSession.socketOperations,
    defaultAccountId: accountId,
    resolveOutboundMentions: ({ jid, text }) => groupMetadata.resolveOutboundMentions(jid, text),
    authDir: options.authDir,
  });

  const admitWithRetry = async (event: ChannelInboundEvent): Promise<boolean> => {
    for (let attempt = 1; attempt <= WHATSAPP_ADMISSION_MAX_ATTEMPTS; attempt += 1) {
      try {
        await options.admit(event);
        return true;
      } catch (error) {
        const detail = formatErrorMessage(error);
        if (attempt === WHATSAPP_ADMISSION_MAX_ATTEMPTS || options.abortSignal.aborted) {
          logger?.error?.(
            `[${accountId}] WhatsApp message ${event.externalMessageId} dropped after ${attempt} admission attempts (WhatsApp does not redeliver it): ${detail}`,
          );
          return false;
        }
        logger?.warn(`[${accountId}] WhatsApp admission failed (attempt ${attempt}), retrying: ${detail}`);
        await sleep(WHATSAPP_ADMISSION_RETRY_DELAY_MS * attempt, options.abortSignal).catch(
          () => undefined,
        );
      }
    }
    return false;
  };

  const polls =
    options.polls === undefined
      ? undefined
      : createWhatsAppPollIntake({
          accountId,
          polls: options.polls,
          selfJids: () => [
            socketSession.self.jid,
            socketSession.self.lid,
            options.sock.user?.id,
            options.sock.user?.lid,
          ],
          resolveVoterId: socketSession.resolveInboundJid,
          admit: admitWithRetry,
          ...(logger ? { logger } : {}),
        });

  const cards =
    options.cards === undefined
      ? undefined
      : createWhatsAppCardIntake({
          accountId,
          cards: options.cards,
          selfJid: () => socketSession.self.jid ?? options.sock.user?.id,
          resolveActorId: socketSession.resolveInboundJid,
          admit: admitWithRetry,
          ...(logger ? { logger } : {}),
        });

  /** Upstream's quote cache entry, and whether an answer should quote this message. */
  const rememberForQuotes = (
    msg: WAMessage,
    inbound: WhatsAppNormalizedInboundMessage,
    enriched: WhatsAppEnrichedInboundMessage,
  ) => {
    if (!inbound.id) return;
    cacheInboundMessageMeta(accountId, inbound.remoteJid, inbound.id, {
      participant: inbound.participantJid,
      participantE164: inbound.group ? undefined : (inbound.senderE164 ?? undefined),
      body: enriched.body,
      media: enriched.nativeMedia,
      fromMe: Boolean(msg.key?.fromMe),
    });
    noteWhatsAppInboundForQuote({
      accountId,
      chatJid: inbound.remoteJid,
      messageId: inbound.id,
    });
  };

  const isStaleAppend = (msg: WAMessage, upsertType: string | undefined): boolean => {
    if (upsertType !== "append") return false;
    const seconds = parseTimestampSeconds(msg.messageTimestamp);
    const sentAtMs = seconds !== undefined ? seconds * 1000 : 0;
    return sentAtMs < socketSession.connectedAtMs - APPEND_RECENT_GRACE_MS;
  };

  const receive = async (msg: WAMessage, upsertType: string | undefined): Promise<void> => {
    socketSession.rememberBaileysMessage(msg.key?.remoteJid, msg.key?.id, msg.message);
    if (isStaleAppend(msg, upsertType)) return;
    if (await cards?.handleReaction(msg)) return;
    await polls?.store(msg);
    if (await polls?.handleVote(msg)) return;
    const inbound = await normalizer.normalize(msg);
    if (!inbound) return;
    const readReceipt =
      inbound.id && !inbound.access.isSelfChat && options.sendReadReceipts !== false
        ? {
            remoteJid: inbound.remoteJid,
            id: inbound.id,
            ...(inbound.participantJid ? { participant: inbound.participantJid } : {}),
          }
        : undefined;
    const markRead = async () => {
      if (!readReceipt) return;
      await socketSession.markRead(readReceipt).catch((error: unknown) => {
        logVerbose(`Failed to mark message ${readReceipt.id} read: ${String(error)}`);
      });
    };
    const enriched = await withWhatsAppMediaDownloadDir(options.mediaDownloadDir, () =>
      enrichWhatsAppInboundMessage({
        msg,
        sock: options.sock,
        mediaMaxMb: options.mediaMaxMb,
        logVerbose,
      }),
    );
    if (!enriched) {
      await markRead();
      return;
    }
    const build = buildWhatsAppInboundEvent({
      msg,
      inbound,
      enriched,
      self: socketSession.self,
      mediaBytes: fileSizeOrZero,
    });
    if (!build.admit) return;
    options.onInbound?.(Date.now());
    if (!(await admitWithRetry(build.event))) return;
    rememberForQuotes(msg, inbound, enriched);
    await markRead();
  };

  let tail: Promise<void> = Promise.resolve();
  const onUpsert = (upsert: { type?: string; messages?: WAMessage[] }) => {
    if (upsert.type !== "notify" && upsert.type !== "append") return;
    for (const msg of upsert.messages ?? []) {
      tail = tail
        .then(() => receive(msg, upsert.type))
        .catch((error: unknown) => {
          logger?.error?.(`[${accountId}] WhatsApp inbound message failed: ${formatErrorMessage(error)}`);
        });
    }
  };

  const detach = socketSession.listen(
    "messages.upsert",
    onUpsert as unknown as (...args: unknown[]) => void,
  );
  socketSession.start();
  groupMetadata.start();

  return {
    close: async () => {
      detach();
      socketSession.stop();
      groupMetadata.close();
      await tail.catch(() => undefined);
      socketSession.closeSocket();
    },
    onClose: socketSession.onClose,
    signalClose: socketSession.signalClose,
    assertSendReady: socketSession.assertSendReady,
    sendComposingTo: sendApi.sendComposingTo,
    sendMessage: sendApi.sendMessage,
    sendPoll: async (to: string, poll: Parameters<typeof sendApi.sendPoll>[1]) => {
      const result = await sendApi.sendPoll(to, poll);
      await polls?.rememberSent(result, options.recentMessageKeys);
      return result;
    },
    sendReaction: sendApi.sendReaction,
  } as ManagedWhatsAppListener;
}
