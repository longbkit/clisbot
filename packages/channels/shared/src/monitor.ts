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

/**
 * The inbound FAMILY one event belongs to. The Hub's routing policy decides
 * per family whether the event may start an agent turn (`inbound-kinds.ts`),
 * so a reaction or a join never reaches an always-reply agent as user text.
 *
 * Absent means `message`: a vertical written before this field existed keeps
 * its old behaviour with no shim on either side.
 */
export type ChannelInboundKind =
  | "message"
  | "command"
  | "callback"
  | "edit"
  | "delete"
  | "reaction"
  | "member"
  | "channel"
  | "pin"
  | "topic"
  | "poll_answer"
  | "interactive";

/** `kind: "command"` — a native slash command or a leading `/verb` line. */
export interface ChannelInboundCommandFacts {
  /** The verb WITHOUT its leading slash, lowercased (`"status"`). */
  name: string;
  /** Everything after the verb, trimmed; empty when the command was bare. */
  args: string;
}

/** `kind: "callback" | "interactive"` — a button, select, or modal submit. */
export interface ChannelInboundCallbackFacts {
  /** Slack `action_id` / modal `callback_id`; Telegram's decoded command. */
  actionId: string;
  /** The element's opaque value (button value, selection, modal metadata). */
  value?: string;
  /** The clicking user's native id — the callback's authority fact. */
  actorId: string;
  /** The card's own message id (the in-place-update target). */
  messageId?: string;
}

/** `kind: "reaction"` — an emoji added to or removed from a message. */
export interface ChannelInboundReactionFacts {
  /** The emoji NAME (Slack `+1`) or character (Telegram `👍`). */
  emoji: string;
  /** True for an add, false for a remove/clear. */
  added: boolean;
  /** The message the reaction sits on. */
  messageId: string;
  /** The reacting user's native id. */
  actorId: string;
}

/** `kind: "edit" | "delete" | "pin"` — the message the event acts on. The
 * event's own `externalMessageId` is its dedupe identity, which for these
 * families is the notification, not the subject. */
export interface ChannelInboundTargetFacts {
  messageId: string;
}

/** `kind: "member"` — a join or a leave. */
export interface ChannelInboundMemberFacts {
  userId: string;
  joined: boolean;
}

/** `kind: "poll_answer"` — one voter's selection. */
export interface ChannelInboundPollAnswerFacts {
  pollId: string;
  optionIds: number[];
  voterId: string;
}

/** `kind: "topic"` — a forum topic / thread lifecycle event. */
export interface ChannelInboundTopicFacts {
  /** The topic's own thread id, when the platform carries one. */
  threadId?: string;
  /** The topic name, when the event names it. */
  name?: string;
  /** The lifecycle verb (`created`, `renamed`, `closed`, …). */
  event: string;
}

/** The structured facts one non-message inbound event carries. Every member is
 * optional and only the ones matching `kind` are populated; the Hub reads them
 * by kind and falls back to `body` (the human-readable rendering) for the rest. */
export interface ChannelInboundFacts {
  command?: ChannelInboundCommandFacts;
  callback?: ChannelInboundCallbackFacts;
  reaction?: ChannelInboundReactionFacts;
  target?: ChannelInboundTargetFacts;
  member?: ChannelInboundMemberFacts;
  pollAnswer?: ChannelInboundPollAnswerFacts;
  topic?: ChannelInboundTopicFacts;
}

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
  /** The inbound family. Absent = `message`. */
  kind?: ChannelInboundKind;
  /** The structured facts for `kind`; absent = `body` is all there is. */
  facts?: ChannelInboundFacts;
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
  // The inbound family + its structured facts. `EventKind` is flat like every
  // other routing fact; the per-kind facts ride in ONE nested key rather than a
  // dozen flat ones, because the Hub reads them as a unit after it has branched
  // on the kind (`plane/inbound-kinds.ts`).
  payload["EventKind"] = event.kind ?? "message";
  if (event.facts !== undefined && Object.keys(event.facts).length > 0) {
    payload["EventFacts"] = event.facts;
  }
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

  forget(id: string): void {
    this.ids.delete(id);
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
    if (!seen.remember(event.externalEventId))
      return { dispatched: false, reason: "in-flight duplicate" };
    if (
      event.isOwnMessage === true ||
      (options.botId !== undefined && event.senderId === options.botId)
    )
      return { dispatched: false, reason: "own message" };
    if (event.body.trim() === "") return { dispatched: false, reason: "empty body" };

    // Queue admission is the ACK/offset boundary. Persist the complete normalized
    // event before invoking the Hub so a crash can be drained after restart.
    const queue = hostRuntime.inboundQueue;
    if (queue !== undefined) {
      let admitted: Awaited<ReturnType<typeof queue.enqueue>>;
      try {
        admitted = await queue.enqueue({
          channel,
          accountId,
          externalEventId: event.externalEventId,
          externalMessageId: event.externalMessageId,
          externalConversationId: event.externalConversationId,
          ...(event.messageThreadId === undefined
            ? {}
            : { externalThreadId: event.messageThreadId }),
          laneKey: `${channel}:${accountId}:${event.externalConversationId}:${event.messageThreadId ?? "root"}`,
          payload: {
            channel,
            accountId,
            ctxPayload: buildInboundCtxPayload(event, accountId),
          },
        });
      } catch (error) {
        // The provider must retry when durable admission fails. Do not let the
        // in-process seen set turn that retry into a false replay.
        seen.forget(event.externalEventId);
        throw error;
      }
      if (!admitted.created) return { dispatched: false, reason: "queue replay" };
      // Keep the existing ledger as an audit join, but never use it as the queue
      // admission gate (the queue owns payload durability and replay).
      if (sink !== undefined) {
        await sink.record({
          channel,
          accountId,
          externalConversationId: event.externalConversationId,
          externalMessageId: event.externalMessageId,
          ...(event.senderId !== "" ? { senderIdentity: event.senderId } : {}),
        });
      }
      // The supervisor-owned drain claims and dispatches the payload. Returning
      // after admission is the provider ACK/offset boundary.
      return { dispatched: true, reason: "queued" };
    }

    // Compatibility path for unit fixtures and hosts that have no queue yet.
    if (sink !== undefined) {
      const recorded = await sink.record({
        channel,
        accountId,
        externalConversationId: event.externalConversationId,
        externalMessageId: event.externalMessageId,
        ...(event.senderId !== "" ? { senderIdentity: event.senderId } : {}),
      });
      if (!recorded.created) return { dispatched: false, reason: "ledger replay" };
    }
    try {
      const result = await hostRuntime.onInboundReply({
        channel,
        accountId,
        ctxPayload: buildInboundCtxPayload(event, accountId),
      });
      if (result.dispatched && sink !== undefined)
        await sink.consume({
          channel,
          accountId,
          externalConversationId: event.externalConversationId,
          externalMessageId: event.externalMessageId,
          turnId: inboundTurnId(event),
        });
      return {
        dispatched: result.dispatched,
        ...(result.dispatched ? {} : { reason: "plane declined" }),
      };
    } catch (error) {
      logger?.warn("inbound handoff fault (kept polling)", {
        channel,
        accountId,
        externalMessageId: event.externalMessageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { dispatched: false, reason: "handoff fault" };
    }
  }

  return {
    process,
    get seenSize(): number {
      return seen.size;
    },
  };
}
