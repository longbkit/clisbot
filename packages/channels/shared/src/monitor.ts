// The shared L3 inbound monitor (blueprint §3 layer L3, channel-agnostic):
// in-flight dedupe, own-message filter, the flat `ctxPayload` build
// (docs/audits/pinned-vertical-contracts/inbound.md), the inbound ledger
// record + consume-mark (Hub-owned, blueprint §2.4), and the
// `onInboundReply` handoff.
//
// The L2 transport (per channel) owns its own loop — Telegram's getUpdates
// long-poll, Slack's Socket Mode — and hands each native event to
// `createInboundEventProcessor`'s `process()`. The L3 never touches the
// transport: no offsets, no sockets, no reconnects. Offset persistence is
// an L2 concern (the transport's redelivery model differs per channel); the
// L3's in-flight set + the durable ledger row are the dedupe that both
// transports share.
//
// Mention gating is deliberately NOT here: `WasMentioned` is a FACT the L3
// passes through in the ctxPayload; the Hub plane owns the mention policy
// (route matching + `fallback`). One policy layer, on the Hub side.

import type {
  ChannelInboundContext,
  HostChildLogger,
  HostRuntime,
  InboundLedgerSink,
} from "./host.js";

/** The native facts one inbound channel event carries, normalized by the L2
 * transport from its raw event (a Telegram `update.message`, a Slack
 * `message` event payload). Ids are the channel-native ones — no prefixing,
 * no renaming; the `external_*` naming is the ledger's job. */
export interface ChannelInboundEvent {
  /** The channel id (`"telegram"` / `"slack"`). */
  channel: string;
  /** The transport-level unique event id (Telegram `update_id`, Slack
   * `event_id`) — the in-flight dedupe key. */
  externalEventId: string;
  /** The channel-native message id (Slack ts / Telegram message id) — the
   * durable ledger dedupe key. */
  externalMessageId: string;
  /** The channel-native conversation id (Slack channel id / Telegram chat id). */
  externalConversationId: string;
  /** The native conversation kind (`direct` / `group` / `channel`). */
  chatType: string;
  /** The native thread/topic id (Slack thread ts / Telegram
   * `message_thread_id`); null at root level. */
  messageThreadId?: string | null;
  /** The sender's native id (Slack `U…` / Telegram numeric). */
  senderId: string;
  senderName?: string;
  senderUsername?: string;
  /** The message text. */
  body: string;
  /** True when the bot was explicitly mentioned / addressed. */
  wasMentioned: boolean;
  /** Event timestamp, milliseconds. */
  timestampMs: number;
  /** The reply target (defaults to the conversation id). */
  replyTo?: string;
  /** The display label (channel / group name); optional. */
  conversationLabel?: string;
  /** Pre-filter fact: true when the event is the channel's own bot message. */
  isOwnMessage?: boolean;
}

/** The flat ctxPayload the Hub plane's normalizer reads
 * (docs/audits/pinned-vertical-contracts/inbound.md — exact key names). */
export function buildInboundCtxPayload(
  event: ChannelInboundEvent,
  accountId: string,
): ChannelInboundContext {
  const payload: ChannelInboundContext = {
    Body: event.body,
    BodyForAgent: event.body,
    ChatType: event.chatType,
    ChatId: event.externalConversationId,
    From: event.senderId,
    To: event.replyTo ?? event.externalConversationId,
    MessageSid: event.externalMessageId,
    Timestamp: event.timestampMs,
    SenderId: event.senderId,
    WasMentioned: event.wasMentioned,
    NativeChannelId: event.externalConversationId,
    CommandAuthorized: false,
    AccountId: accountId,
    OriginatingChannel: event.channel,
    OriginatingTo: event.replyTo ?? event.externalConversationId,
  };
  if (event.messageThreadId !== null && event.messageThreadId !== undefined) {
    payload["MessageThreadId"] = event.messageThreadId;
  }
  if (event.senderName !== undefined) payload["SenderName"] = event.senderName;
  if (event.senderUsername !== undefined) payload["SenderUsername"] = event.senderUsername;
  if (event.conversationLabel !== undefined) payload["ConversationLabel"] = event.conversationLabel;
  return payload;
}

/** The inbound row's turn reference (blueprint §2.4: "the turn reference the
 * row dispatched to"). Stable per (channel, account, message) so a recall can
 * join the inbound row to the agent turn it started. */
export function inboundTurnId(
  event: Pick<ChannelInboundEvent, "channel" | "externalMessageId">,
): string {
  return `${event.channel}:${event.externalMessageId}`;
}

/** In-flight event-id set with a cap (evict-oldest by insertion order). The
 * transport redelivers events on reconnects (Slack Socket Mode) or after a
 * missed offset (Telegram); the set drops the same-run duplicates. */
class SeenEventIds {
  private readonly ids = new Set<string>();
  private readonly cap: number;

  constructor(cap: number) {
    this.cap = cap;
  }

  /** True when the id was NOT seen before (and is now recorded). */
  remember(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.cap) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
    return true;
  }

  get size(): number {
    return this.ids.size;
  }
}

export interface InboundEventProcessorOptions {
  hostRuntime: HostRuntime;
  channel: string;
  accountId: string;
  /** The channel's own bot id — own messages from the bot are skipped even
   * when the transport does not flag them. */
  botId?: string;
  /** In-flight dedupe cap; default 4096. */
  seenCap?: number;
  /** The logger to route L3 diagnostics through; default silent. */
  logger?: HostChildLogger;
}

export interface InboundEventDecision {
  /** The event was first-sight and was handed to the Hub. */
  dispatched: boolean;
  /** Why the event was not dispatched (first-sight events only reach the
   * handoff; everything else names its drop reason). */
  reason?: string;
}

/** One processor per (channel, account) — owns the in-flight set and the
 * ledger sink for that account's inbound stream. */
export function createInboundEventProcessor(options: InboundEventProcessorOptions): {
  process(event: ChannelInboundEvent): Promise<InboundEventDecision>;
  readonly seenSize: number;
} {
  const { hostRuntime, channel, accountId } = options;
  const seen = new SeenEventIds(options.seenCap ?? 4096);
  const sink: InboundLedgerSink | undefined = hostRuntime.inboundLedger;
  const logger = options.logger;

  async function process(event: ChannelInboundEvent): Promise<InboundEventDecision> {
    // In-flight transport redelivery (same run): drop silently.
    if (!seen.remember(event.externalEventId)) {
      return { dispatched: false, reason: "in-flight duplicate" };
    }
    // Own-bot message: the bot must never answer itself (loop guard).
    if (
      event.isOwnMessage === true ||
      (options.botId !== undefined && event.senderId === options.botId)
    ) {
      return { dispatched: false, reason: "own message" };
    }
    // Empty body: nothing to dispatch.
    if (event.body.trim() === "") {
      return { dispatched: false, reason: "empty body" };
    }
    // Durable dedupe (blueprint §2.4): record BEFORE the handoff. A restart
    // replay or a transport replay of a known message id must not dispatch a
    // second time.
    if (sink !== undefined) {
      const recorded = await sink.record({
        channel,
        accountId,
        externalConversationId: event.externalConversationId,
        externalMessageId: event.externalMessageId,
        ...(event.senderId !== "" ? { senderIdentity: event.senderId } : {}),
      });
      if (!recorded.created) {
        logger?.debug?.("inbound ledger replay: dropping known message", {
          channel,
          accountId,
          externalMessageId: event.externalMessageId,
        });
        return { dispatched: false, reason: "ledger replay" };
      }
    }
    // Handoff to the Hub (the plane owns the policy decision). A handoff fault
    // must never kill the transport loop: log + keep polling (P13).
    let result;
    try {
      result = await hostRuntime.onInboundReply({
        channel,
        accountId,
        ctxPayload: buildInboundCtxPayload(event, accountId),
      });
    } catch (error) {
      logger?.warn("inbound handoff fault (kept polling)", {
        channel,
        accountId,
        externalMessageId: event.externalMessageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { dispatched: false, reason: "handoff fault" };
    }
    // Consume-mark when the dispatch settled (the plane accepted the event).
    // An ignored inbound stays `recorded` in the ledger (audit: the event
    // arrived; the plane declined it).
    if (result.dispatched && sink !== undefined) {
      await sink.consume({
        channel,
        accountId,
        externalConversationId: event.externalConversationId,
        externalMessageId: event.externalMessageId,
        turnId: inboundTurnId(event),
      });
    }
    return {
      dispatched: result.dispatched,
      ...(result.dispatched ? {} : { reason: "plane declined" }),
    };
  }

  return {
    process,
    get seenSize(): number {
      return seen.size;
    },
  };
}
