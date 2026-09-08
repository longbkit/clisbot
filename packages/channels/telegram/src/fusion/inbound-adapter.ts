// Fusion-owned inbound adapter (goal slice 20, D-TG-052).
//
// This is the cut point named in the slice: upstream hands a prepared grammY
// message to OpenClaw's auto-reply pipeline (`bot-handlers.inbound-pipeline` →
// `bot-message-context` → `bot-message-dispatch`, ~19 000 lines that own the
// OpenClaw session store, reply pipeline, native-command registry and approval
// gateway). Fusion's Hub owns all of that, so the vertical stops one step
// earlier and produces the shared `ChannelInboundEvent` the Hub's monitor
// admits (`packages/channels/shared/src/monitor.ts`).
//
// Everything that can be answered from upstream source is: mention facts,
// text/caption/entity extraction, forwarded-origin normalization, location
// extraction and primary-media resolution all come from the ported
// `bot/body-helpers.ts`. What upstream expresses as typed `MsgContext` members
// (`ReplyChain`, `ForwardedFrom*`, media facts) has no home in the Hub's flat
// ctxPayload, so those facts are rendered into `body` under stable bracket
// labels; the Hub reads them as prompt text today and can promote them to
// typed fields when its inbound contract grows.
//
// Two audited inbound bugs are fixed here rather than upstream-side, because
// upstream has no equivalent check:
//   * `text_mention` of our bot (a user-link mention, which carries `user.id`
//     and no `@username`) counts as a mention. Upstream's `hasBotMention` only
//     inspects `mention` and `bot_command` entities, so a `text_mention` of a
//     bot without a public username was invisible.
//   * `/cmd@other_bot` is not ours. Upstream ships the predicate
//     (`hasLeadingBotCommandAddressedToOtherBot`) but the Fusion transport
//     never called it: any `/command` line was treated as addressing us.

import type { ChannelInboundEvent, ChannelInboundKind } from "@getpaseo/channels-shared";
import type {
  CallbackQuery,
  Chat,
  ChatMemberUpdated,
  Message,
  MessageReactionUpdated,
  PollAnswer,
  Update,
  User,
} from "grammy/types";
import { formatLocationText } from "@getpaseo/channels-core/plugin-sdk/channel-inbound";
import {
  buildSenderLabel,
  buildSenderName,
  extractTelegramLocation,
  getTelegramTextParts,
  hasBotMention,
  normalizeForwardedContext,
} from "../bot/body-helpers.js";
import { hasLeadingBotCommandAddressedToOtherBot } from "../bot/body-helpers.js";
import { isTelegramForumServiceMessage } from "../forum-service-message.js";
import { parseTelegramNativeCommandCallbackData } from "../native-command-callback-data.js";

/** The inbound shapes this vertical emits. One `ChannelInboundEvent` each. */
export type TelegramInboundKind =
  | "message"
  | "command"
  | "edited_message"
  | "callback_query"
  | "message_reaction"
  | "poll_answer"
  | "chat_member"
  | "topic_event";

/** The shared inbound family each native Telegram update belongs to. The
 * vertical keeps its own native vocabulary (`TelegramInboundKind`); this is the
 * channel-agnostic family the Hub's routing policy decides on. */
export const TELEGRAM_INBOUND_KIND: Record<TelegramInboundKind, ChannelInboundKind> = {
  message: "message",
  command: "command",
  edited_message: "edit",
  callback_query: "callback",
  message_reaction: "reaction",
  poll_answer: "poll_answer",
  chat_member: "member",
  topic_event: "topic",
};

export interface TelegramInboundBuild {
  kind: TelegramInboundKind;
  event: ChannelInboundEvent;
  /** The Bot API messages this event was built from: a media group contributes
   * every message it buffered, a plain message exactly one, and a non-message
   * update (reaction, poll answer, callback) none. The admission step folds
   * their media into `event.body` and records each one as a provider
   * observation for the thread-binding check. */
  messages: Message[];
}

export interface TelegramInboundParams {
  accountId: string;
  botId: number;
  botUsername?: string;
}

/** Mention facts for one message. `wasMentioned` is a FACT, never a policy
 * decision — route matching and `fallback` stay on the Hub (D-011). */
export interface TelegramMentionFacts {
  wasMentioned: boolean;
  /** The message opens with `/cmd@some_other_bot`: not addressed to us. */
  addressedToOtherBot: boolean;
  /** The leading `/command` token, lowercased and without the `@bot` suffix. */
  command?: string;
}

const COMMAND_RE = /^\s*\/([a-z0-9_]+)(@[a-z0-9_]+)?(?:\s|$)/iu;

/** True when any entity is a `text_mention` naming our bot. Upstream's
 * `hasBotMention` does not look at `text_mention`; a user-link mention of a
 * bot with no public username was therefore never seen as a mention. */
export function hasTelegramTextMentionOfBot(msg: Message, botId: number): boolean {
  const { entities } = getTelegramTextParts(msg);
  return entities.some((entity) => {
    if (entity.type !== "text_mention") return false;
    const user = (entity as { user?: User }).user;
    return user?.id === botId;
  });
}

export function resolveTelegramMentionFacts(
  msg: Message,
  params: TelegramInboundParams,
): TelegramMentionFacts {
  const username = params.botUsername ?? "";
  const addressedToOtherBot =
    username !== "" && hasLeadingBotCommandAddressedToOtherBot(msg, username);
  const { text } = getTelegramTextParts(msg);
  const match = COMMAND_RE.exec(text);
  const command = match?.[1] !== undefined ? `/${match[1].toLowerCase()}` : undefined;
  if (addressedToOtherBot) {
    // A command explicitly handed to another bot in the group is not ours,
    // and it is not a mention of us either.
    return { wasMentioned: false, addressedToOtherBot: true, ...(command ? { command } : {}) };
  }
  const wasMentioned =
    (username !== "" && hasBotMention(msg, username)) ||
    hasTelegramTextMentionOfBot(msg, params.botId) ||
    // A `/command` with no `@bot` suffix addresses whichever bots own it; a
    // `/command@us` suffix is already caught by `hasBotMention`.
    (command !== undefined && match?.[2] === undefined);
  return { wasMentioned, addressedToOtherBot: false, ...(command ? { command } : {}) };
}

/** `private` → `direct`; every other native chat kind → `group` (the plane has
 * no distinct Telegram "channel" kind — same table as `approval-callback.ts`). */
export function telegramChatType(chat: Pick<Chat, "type"> | undefined): string {
  return chat?.type === "private" ? "direct" : "group";
}

function threadIdOf(msg: { message_thread_id?: number }): string | null {
  return msg.message_thread_id === undefined ? null : String(msg.message_thread_id);
}

function senderFields(from: User | undefined): Partial<ChannelInboundEvent> {
  if (from === undefined) return {};
  return {
    ...(from.first_name !== undefined ? { senderName: from.first_name } : {}),
    ...(from.username !== undefined ? { senderUsername: from.username } : {}),
  };
}

/** A channel post is authored by a chat, not a user: Telegram carries the
 * author in `sender_chat` and leaves `from` absent. */
function senderChatFields(senderChat: Chat | undefined): Partial<ChannelInboundEvent> {
  const chat = senderChat as { title?: string; username?: string } | undefined;
  if (chat === undefined) return {};
  return {
    ...(chat.title !== undefined ? { senderName: chat.title } : {}),
    ...(chat.username !== undefined ? { senderUsername: chat.username } : {}),
  };
}

function conversationLabel(chat: Chat | undefined): Partial<ChannelInboundEvent> {
  const title = (chat as { title?: string } | undefined)?.title;
  return title !== undefined ? { conversationLabel: title } : {};
}

// ------------------------------------------------------------------- body

/** Stable labels for the facts upstream carries as typed `MsgContext` members.
 * They are part of the Hub-facing contract: the Hub parses or strips them. */
export const TELEGRAM_BODY_LABELS = {
  forwarded: "[Forwarded from",
  replyTo: "[Reply to",
  quote: "[Quote]",
  edited: "[Edited]",
  reaction: "[Reaction]",
  pollAnswer: "[Poll answer]",
  callback: "[Button]",
  joined: "[Joined]",
  left: "[Left]",
  topic: "[Topic]",
} as const;

function replyContextLines(msg: Message): string[] {
  const lines: string[] = [];
  const replyTo = msg.reply_to_message;
  if (replyTo !== undefined) {
    const label = buildSenderLabel(replyTo, replyTo.from?.id);
    const { text } = getTelegramTextParts(replyTo);
    const snippet = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    lines.push(`${TELEGRAM_BODY_LABELS.replyTo} ${label}] ${snippet}`.trimEnd());
  }
  const quote = msg.quote?.text;
  if (typeof quote === "string" && quote !== "") {
    lines.push(`${TELEGRAM_BODY_LABELS.quote} ${quote}`);
  }
  const forwarded = normalizeForwardedContext(msg);
  if (forwarded !== null) {
    lines.push(`${TELEGRAM_BODY_LABELS.forwarded} ${forwarded.from}]`);
  }
  return lines;
}

/** The message body: upstream's `[rawText, locationText]` join, prefixed with
 * the reply/quote/forward context lines the Hub's ctxPayload cannot type. */
export function buildTelegramMessageBody(messages: readonly Message[]): string {
  const parts: string[] = [];
  const first = messages[0];
  if (first !== undefined) parts.push(...replyContextLines(first));
  for (const msg of messages) {
    const { text } = getTelegramTextParts(msg);
    if (text !== "") parts.push(text);
    const location = extractTelegramLocation(msg);
    if (location !== null) parts.push(formatLocationText(location));
  }
  return parts.join("\n").trim();
}

// ------------------------------------------------------------------ builders

function baseMessageEvent(
  messages: readonly Message[],
  updateId: number,
  params: TelegramInboundParams,
): ChannelInboundEvent | null {
  const anchor = messages[0];
  const last = messages[messages.length - 1];
  if (anchor === undefined || last === undefined) return null;
  const chat = anchor.chat;
  const from = anchor.from;
  // A channel post has no `from`: Telegram attributes it to the posting chat
  // (`sender_chat`), which is also how an anonymous group admin posts. Reading
  // only `from` dropped the whole `channel_post` family at the door.
  const senderChat = anchor.sender_chat;
  const senderId =
    from?.id !== undefined
      ? String(from.id)
      : senderChat?.id !== undefined
        ? String(senderChat.id)
        : undefined;
  if (chat?.id === undefined || senderId === undefined) return null;
  const mention = resolveTelegramMentionFacts(anchor, params);
  return {
    channel: "telegram",
    externalEventId: `update:${updateId}`,
    externalMessageId: String(anchor.message_id),
    externalConversationId: String(chat.id),
    chatType: telegramChatType(chat),
    messageThreadId: threadIdOf(anchor),
    senderId,
    ...(from === undefined ? senderChatFields(senderChat) : senderFields(from)),
    body: buildTelegramMessageBody(messages),
    wasMentioned: mention.wasMentioned,
    timestampMs: typeof anchor.date === "number" ? anchor.date * 1000 : Date.now(),
    ...conversationLabel(chat),
    // Loop guard: own ONLY when the sender is this bot. A different bot (the
    // E2E master bot, any automation bot) is a legitimate external sender.
    isOwnMessage: senderId === String(params.botId),
  };
}

/** One message (or a whole media group) → the inbound event. `null` when the
 * message carries no attributable sender/chat, or is addressed to another bot. */
export function buildTelegramMessageEvent(
  messages: readonly Message[],
  updateId: number,
  params: TelegramInboundParams,
  options: { edited?: boolean } = {},
): TelegramInboundBuild | null {
  const anchor = messages[0];
  if (anchor === undefined) return null;
  const mention = resolveTelegramMentionFacts(anchor, params);
  if (mention.addressedToOtherBot) return null;
  const topic = buildTelegramTopicEvent(anchor, updateId, params);
  if (topic !== null) return topic;
  const membership = buildTelegramMembershipEvent(anchor, updateId);
  if (membership !== null) return membership;
  const event = baseMessageEvent(messages, updateId, params);
  if (event === null) return null;
  if (options.edited === true) {
    event.body = `${TELEGRAM_BODY_LABELS.edited} ${event.body}`.trim();
  }
  const kind: TelegramInboundKind =
    options.edited === true ? "edited_message" : mention.command ? "command" : "message";
  event.kind = TELEGRAM_INBOUND_KIND[kind];
  if (kind === "edited_message") {
    event.facts = { target: { messageId: String(anchor.message_id) } };
  } else if (kind === "command" && mention.command !== undefined) {
    // `mention.command` is the leading `/verb` with its `@bot` suffix already
    // stripped; the args are the rest of the first line.
    const { text } = getTelegramTextParts(anchor);
    const args = COMMAND_RE.exec(text) === null ? "" : text.replace(COMMAND_RE, "").trim();
    event.facts = { command: { name: mention.command.slice(1), args } };
  }
  return {
    kind,
    event,
    messages: [...messages],
  };
}

/** A forum service message (`forum_topic_created` and friends) → topic event. */
export function buildTelegramTopicEvent(
  msg: Message,
  updateId: number,
  params: TelegramInboundParams,
): TelegramInboundBuild | null {
  if (!isTelegramForumServiceMessage(msg)) return null;
  const chat = msg.chat;
  if (chat?.id === undefined) return null;
  const created = msg.forum_topic_created;
  const edited = msg.forum_topic_edited;
  const detail = created
    ? `created "${created.name}"`
    : edited
      ? `edited${edited.name === undefined ? "" : ` "${edited.name}"`}`
      : msg.forum_topic_closed
        ? "closed"
        : msg.forum_topic_reopened
          ? "reopened"
          : msg.general_forum_topic_hidden
            ? "general hidden"
            : "general unhidden";
  const topicName = created?.name ?? edited?.name;
  const from = msg.from;
  return {
    kind: "topic_event",
    event: {
      channel: "telegram",
      externalEventId: `update:${updateId}`,
      externalMessageId: String(msg.message_id),
      externalConversationId: String(chat.id),
      chatType: telegramChatType(chat),
      messageThreadId: threadIdOf(msg),
      senderId: from?.id === undefined ? "" : String(from.id),
      ...senderFields(from),
      body: `${TELEGRAM_BODY_LABELS.topic} ${detail}`,
      wasMentioned: false,
      timestampMs: typeof msg.date === "number" ? msg.date * 1000 : Date.now(),
      ...conversationLabel(chat),
      isOwnMessage: from?.id === params.botId,
      kind: "topic",
      facts: {
        topic: {
          ...(threadIdOf(msg) === null ? {} : { threadId: threadIdOf(msg)! }),
          ...(topicName === undefined ? {} : { name: topicName }),
          event: detail,
        },
      },
    },
    messages: [],
  };
}

/** `new_chat_members` / `left_chat_member` service messages → join/leave. */
export function buildTelegramMembershipEvent(
  msg: Message,
  updateId: number,
): TelegramInboundBuild | null {
  const joined = msg.new_chat_members;
  const left = msg.left_chat_member;
  if ((joined === undefined || joined.length === 0) && left === undefined) return null;
  const chat = msg.chat;
  if (chat?.id === undefined) return null;
  const who =
    joined !== undefined && joined.length > 0
      ? joined.map((user) => buildSenderName({ from: user } as Message) ?? String(user.id))
      : [buildSenderName({ from: left } as Message) ?? String(left?.id)];
  const label = joined !== undefined && joined.length > 0 ? "joined" : "left";
  const from = msg.from;
  return {
    kind: "chat_member",
    event: {
      channel: "telegram",
      externalEventId: `update:${updateId}`,
      externalMessageId: String(msg.message_id),
      externalConversationId: String(chat.id),
      chatType: telegramChatType(chat),
      messageThreadId: threadIdOf(msg),
      senderId: from?.id === undefined ? "" : String(from.id),
      ...senderFields(from),
      body: `${label === "joined" ? TELEGRAM_BODY_LABELS.joined : TELEGRAM_BODY_LABELS.left} ${who.join(", ")}`,
      wasMentioned: false,
      timestampMs: typeof msg.date === "number" ? msg.date * 1000 : Date.now(),
      ...conversationLabel(chat),
      isOwnMessage: false,
      kind: "member",
      facts: {
        member: {
          userId: String(
            (joined !== undefined && joined.length > 0 ? joined[0]?.id : left?.id) ?? "",
          ),
          joined: label === "joined",
        },
      },
    },
    messages: [],
  };
}

/** `chat_member` / `my_chat_member` update → membership event. */
export function buildTelegramChatMemberEvent(
  updated: ChatMemberUpdated,
  updateId: number,
  params: TelegramInboundParams,
): TelegramInboundBuild | null {
  const chat = updated.chat;
  if (chat?.id === undefined) return null;
  const status = updated.new_chat_member?.status;
  const gone = status === "left" || status === "kicked";
  const who = updated.new_chat_member?.user;
  return {
    kind: "chat_member",
    event: {
      channel: "telegram",
      externalEventId: `update:${updateId}`,
      externalMessageId: `chat-member:${updated.date}:${who?.id ?? "unknown"}`,
      externalConversationId: String(chat.id),
      chatType: telegramChatType(chat),
      messageThreadId: null,
      senderId: updated.from?.id === undefined ? "" : String(updated.from.id),
      ...senderFields(updated.from),
      body: `${gone ? TELEGRAM_BODY_LABELS.left : TELEGRAM_BODY_LABELS.joined} ${
        who === undefined
          ? "unknown"
          : (buildSenderName({ from: who } as Message) ?? String(who.id))
      } (${status ?? "unknown"})`,
      wasMentioned: false,
      timestampMs: updated.date * 1000,
      ...conversationLabel(chat),
      isOwnMessage: updated.from?.id === params.botId,
      kind: "member",
      facts: { member: { userId: String(who?.id ?? ""), joined: !gone } },
    },
    messages: [],
  };
}

/** `message_reaction` update → reaction event. */
export function buildTelegramReactionEvent(
  reaction: MessageReactionUpdated,
  updateId: number,
  params: TelegramInboundParams,
): TelegramInboundBuild | null {
  const chat = reaction.chat;
  if (chat?.id === undefined) return null;
  const emojis = (reaction.new_reaction ?? [])
    .map((entry) =>
      entry.type === "emoji"
        ? entry.emoji
        : entry.type === "custom_emoji"
          ? `custom:${entry.custom_emoji_id}`
          : "paid",
    )
    .join(" ");
  const user = reaction.user;
  return {
    kind: "message_reaction",
    event: {
      channel: "telegram",
      externalEventId: `update:${updateId}`,
      externalMessageId: String(reaction.message_id),
      externalConversationId: String(chat.id),
      chatType: telegramChatType(chat),
      messageThreadId: null,
      senderId: user?.id === undefined ? "" : String(user.id),
      ...senderFields(user),
      body: `${TELEGRAM_BODY_LABELS.reaction} ${emojis === "" ? "(cleared)" : emojis} on message ${reaction.message_id}`,
      wasMentioned: false,
      timestampMs: reaction.date * 1000,
      ...conversationLabel(chat),
      isOwnMessage: user?.id === params.botId,
      kind: "reaction",
      facts: {
        reaction: {
          emoji: emojis,
          // A cleared reaction list is a REMOVE: Telegram sends the new set,
          // and an empty new set means every reaction came off.
          added: emojis !== "",
          messageId: String(reaction.message_id),
          actorId: user?.id === undefined ? "" : String(user.id),
        },
      },
    },
    messages: [],
  };
}

/** `poll_answer` update → poll-answer event. Telegram gives no chat for a poll
 * answer, so the voter's own id is the conversation (the Hub joins it back to
 * the poll through the ported `poll-registry.ts`). */
export function buildTelegramPollAnswerEvent(
  answer: PollAnswer,
  updateId: number,
  params: TelegramInboundParams,
): TelegramInboundBuild | null {
  const voter = answer.user;
  const chatId = answer.voter_chat?.id ?? voter?.id;
  if (chatId === undefined) return null;
  return {
    kind: "poll_answer",
    event: {
      channel: "telegram",
      externalEventId: `update:${updateId}`,
      externalMessageId: `poll:${answer.poll_id}`,
      externalConversationId: String(chatId),
      chatType: telegramChatType(answer.voter_chat),
      messageThreadId: null,
      senderId: voter?.id === undefined ? "" : String(voter.id),
      ...senderFields(voter),
      body: `${TELEGRAM_BODY_LABELS.pollAnswer} poll ${answer.poll_id} options [${answer.option_ids.join(", ")}]`,
      wasMentioned: false,
      timestampMs: Date.now(),
      isOwnMessage: voter?.id === params.botId,
      kind: "poll_answer",
      facts: {
        pollAnswer: {
          pollId: answer.poll_id,
          optionIds: [...answer.option_ids],
          voterId: voter?.id === undefined ? "" : String(voter.id),
        },
      },
    },
    messages: [],
  };
}

/** A `callback_query` whose data is a ported NATIVE-COMMAND callback becomes an
 * inbound event carrying the command plus its authority (clicker id, host
 * message id). Approval and question callbacks keep their own seams; the Hub's
 * approval card value is opaque here (`approval-callback.ts`). */
export function buildTelegramCallbackEvent(
  callbackQuery: CallbackQuery,
  updateId: number,
  params: TelegramInboundParams,
): TelegramInboundBuild | null {
  const command = parseTelegramNativeCommandCallbackData(callbackQuery.data);
  if (command === null) return null;
  const message = callbackQuery.message;
  const chat = message?.chat;
  if (chat?.id === undefined) return null;
  const from = callbackQuery.from;
  return {
    kind: "callback_query",
    event: {
      channel: "telegram",
      externalEventId: `update:${updateId}`,
      externalMessageId: String(message?.message_id ?? callbackQuery.id),
      externalConversationId: String(chat.id),
      chatType: telegramChatType(chat),
      messageThreadId: threadIdOf(message as { message_thread_id?: number }),
      senderId: String(from.id),
      ...senderFields(from),
      body: `${TELEGRAM_BODY_LABELS.callback} ${command}`,
      // A button press on our own card is an explicit address of this bot.
      wasMentioned: true,
      timestampMs: Date.now(),
      ...conversationLabel(chat as Chat),
      isOwnMessage: from.id === params.botId,
      kind: "callback",
      facts: {
        callback: {
          actionId: command,
          actorId: String(from.id),
          ...(message?.message_id === undefined ? {} : { messageId: String(message.message_id) }),
        },
      },
    },
    messages: [],
  };
}

/** The single-update entry point. Media groups are buffered by the caller and
 * handed here as a message list, so this returns at most one build. */
export function buildTelegramInboundEvent(
  update: Update,
  params: TelegramInboundParams,
): TelegramInboundBuild | null {
  const updateId = update.update_id;
  if (update.message !== undefined) {
    return buildTelegramMessageEvent([update.message], updateId, params);
  }
  if (update.channel_post !== undefined) {
    return buildTelegramMessageEvent([update.channel_post], updateId, params);
  }
  if (update.edited_message !== undefined) {
    return buildTelegramMessageEvent([update.edited_message], updateId, params, { edited: true });
  }
  if (update.edited_channel_post !== undefined) {
    return buildTelegramMessageEvent([update.edited_channel_post], updateId, params, {
      edited: true,
    });
  }
  if (update.message_reaction !== undefined) {
    return buildTelegramReactionEvent(update.message_reaction, updateId, params);
  }
  if (update.poll_answer !== undefined) {
    return buildTelegramPollAnswerEvent(update.poll_answer, updateId, params);
  }
  if (update.chat_member !== undefined) {
    return buildTelegramChatMemberEvent(update.chat_member, updateId, params);
  }
  if (update.callback_query !== undefined) {
    return buildTelegramCallbackEvent(update.callback_query, updateId, params);
  }
  return null;
}
