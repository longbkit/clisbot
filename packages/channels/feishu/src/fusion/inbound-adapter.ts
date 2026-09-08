// Fusion-owned inbound normalizer (D-FS-014).
//
// Upstream's `monitor.message-handler.ts` turns a verified Lark event into an
// OpenClaw agent turn: it resolves the session route, applies the DM/group
// access policy, downloads media through the host media store, builds the
// OpenClaw `ctxPayload` and calls the reply dispatcher, which owns the agent
// runtime, the streaming card and the typing indicator. Fusion's Hub owns every
// one of those, so this module does only the part the Hub cannot: turn the
// native event into the channel-agnostic `ChannelInboundEvent` the shared L3
// monitor admits (`@getpaseo/channels-shared`).
//
// The content, mention and chat-type decisions are the ported source's
// (`bot-content.ts`, `mention.ts`, `chat-type.ts`, `card-interaction.ts`); this
// file only chooses which of them applies to which event and fills the envelope.
import type { ChannelInboundEvent } from "@getpaseo/channels-shared";
import { checkBotMentioned, normalizeMentions, parseMessageContent } from "../bot-content.js";
import { decodeFeishuCardAction } from "../card-interaction.js";
import { normalizeFeishuChatType } from "../chat-type.js";
import type { FeishuBotAddedEvent, FeishuMessageEvent } from "../event-types.js";

/** The account facts the normalizer needs; supplied by the admission step. */
export interface FeishuInboundParams {
  accountId: string;
  /** The bot's own `open_id`, from the startup identity probe. */
  botOpenId?: string;
  /** `true` when a bot-authored message may start a turn (`allowBots`). */
  allowBots?: boolean;
}

/** Why a verified event produced no admissible turn. Never a fault. */
export type FeishuInboundSkip =
  | "not-a-turn-event"
  | "own-message"
  | "bot-message"
  | "empty-body"
  | "malformed-payload";

export type FeishuInboundBuild =
  | { admit: true; event: ChannelInboundEvent }
  | { admit: false; reason: FeishuInboundSkip };

/** Lark chat types map onto the Hub's three conversation kinds. `topic_group`
 * is a forum-style supergroup, so it is a channel with a thread id. */
function toChatType(raw: string | undefined): string {
  return normalizeFeishuChatType(raw) === "p2p" ? "direct" : "group";
}

function timestampOf(createTime: string | undefined, fallback: number): number {
  const parsed = Number(createTime);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Normalizes one `im.message.receive_v1` event. The text is upstream's
 * `parseMessageContent` output with the bot's own mention stripped by
 * `normalizeMentions`, so a mention-only message reaches the Hub as an empty
 * body and is skipped rather than starting an empty turn.
 */
export function buildFeishuInboundEvent(
  event: FeishuMessageEvent,
  params: FeishuInboundParams,
  now = Date.now(),
): FeishuInboundBuild {
  const message = event.message;
  // The dispatcher hands this whatever the request body decoded to (a plain
  // `data as FeishuMessageEvent` cast — `fusion/admission.ts`), so the shape is
  // NOT guaranteed. A missing `sender` used to throw a TypeError out of the
  // handler, which the transport answered with 5xx — and Lark redelivers a 5xx,
  // forever, for a payload that can never parse. A skip answers 200 and logs.
  const sender = event.sender as FeishuMessageEvent["sender"] | undefined;
  if (sender?.sender_id === undefined) return { admit: false, reason: "malformed-payload" };
  const senderOpenId = sender.sender_id.open_id ?? "";
  const isBotSender = sender.sender_type === "bot" || sender.sender_type === "app";
  if (senderOpenId !== "" && senderOpenId === params.botOpenId) {
    return { admit: false, reason: "own-message" };
  }
  if (isBotSender && params.allowBots !== true) {
    return { admit: false, reason: "bot-message" };
  }
  if (!message?.message_id || !message.chat_id) {
    return { admit: false, reason: "not-a-turn-event" };
  }
  const parsed = parseMessageContent(message.content, message.message_type);
  const body = normalizeMentions(parsed, message.mentions, params.botOpenId).trim();
  const wasMentioned = checkBotMentioned(event, params.botOpenId);
  // A media-only message has no text but is still a turn: the Hub attaches the
  // downloaded resources. An empty text message with nothing else is not.
  if (body === "" && message.message_type === "text") {
    return { admit: false, reason: "empty-body" };
  }
  const threadId = message.thread_id ?? message.root_id;
  return {
    admit: true,
    event: {
      channel: "feishu",
      externalEventId: message.message_id,
      externalMessageId: message.message_id,
      externalConversationId: message.chat_id,
      chatType: toChatType(message.chat_type),
      ...(threadId === undefined ? {} : { messageThreadId: threadId }),
      senderId: senderOpenId,
      body,
      wasMentioned,
      timestampMs: timestampOf(message.create_time, now),
      replyTo: message.chat_id,
      kind: "message",
    },
  };
}

/** The Lark card-action callback (`card.action.trigger`). The decoded envelope
 * is upstream's `card-interaction.ts` contract, so an approval button carries
 * the same action id the outbound card wrote. */
export function buildFeishuCardActionEvent(
  event: {
    operator: { open_id?: string };
    action: { value: unknown };
    context: { chat_id?: string; open_message_id?: string };
  },
  params: FeishuInboundParams,
  now = Date.now(),
): FeishuInboundBuild {
  // Same unvalidated cast as the message path: a card action with no
  // `context`/`operator` is a permanent payload fault, not a 5xx to redeliver.
  const context = event.context as { chat_id?: string; open_message_id?: string } | undefined;
  const operator = event.operator as { open_id?: string } | undefined;
  if (context === undefined || operator === undefined) {
    return { admit: false, reason: "malformed-payload" };
  }
  const chatId = context.chat_id ?? "";
  const actorId = operator.open_id ?? "";
  if (chatId === "" || actorId === "") return { admit: false, reason: "not-a-turn-event" };
  const decoded = decodeFeishuCardAction({ event, now });
  if (decoded.kind === "invalid") return { admit: false, reason: "not-a-turn-event" };
  const actionId = decoded.kind === "structured" ? decoded.envelope.a : decoded.text;
  const messageId = context.open_message_id;
  return {
    admit: true,
    event: {
      channel: "feishu",
      externalEventId: `${chatId}:card:${messageId ?? actionId}:${now}`,
      externalMessageId: messageId ?? "",
      externalConversationId: chatId,
      chatType:
        decoded.kind === "structured" && decoded.envelope.c?.t === "p2p" ? "direct" : "group",
      senderId: actorId,
      body: actionId === "" ? "card click" : `card click: ${actionId}`,
      // A card button is always addressed at the app that rendered the card.
      wasMentioned: true,
      timestampMs: now,
      replyTo: chatId,
      kind: "callback",
      facts: {
        callback: {
          actionId,
          ...(decoded.kind === "structured" && decoded.envelope.q !== undefined
            ? { value: decoded.envelope.q }
            : {}),
          actorId,
          ...(messageId === undefined ? {} : { messageId }),
        },
      },
    },
  };
}

/** `im.chat.member.bot.added_v1` / `…removed_v1`: the bot joined or left a chat. */
export function buildFeishuBotMemberEvent(
  event: FeishuBotAddedEvent,
  joined: boolean,
  now = Date.now(),
): FeishuInboundBuild {
  const chatId = (event as FeishuBotAddedEvent | undefined)?.chat_id ?? "";
  if (chatId === "") return { admit: false, reason: "malformed-payload" };
  const actorId = event.operator_id?.open_id ?? "";
  return {
    admit: true,
    event: {
      channel: "feishu",
      externalEventId: `${chatId}:bot-${joined ? "added" : "removed"}:${now}`,
      externalMessageId: `${chatId}:bot-${joined ? "added" : "removed"}`,
      externalConversationId: chatId,
      chatType: "group",
      senderId: actorId,
      body: joined ? "bot added to chat" : "bot removed from chat",
      wasMentioned: false,
      timestampMs: now,
      replyTo: chatId,
      kind: "member",
      facts: { member: { userId: actorId, joined } },
    },
  };
}
