// upstream: extensions/telegram/src/bot/helpers.ts@5d8067a4483
// D-TG-017: upstream's `bot/helpers.ts` is the inbound bot helper module (725
// lines): sender identity, command auth, conversation ids, forum-flag probing,
// stream mode, allow-from config. The command-auth / allow-from / forum-probe
// halves stay Hub-owned in Fusion (goal slices 1-3, 23), so this file carries
// the thread-identity half the ported send path calls plus upstream's own
// `body-helpers` re-export block (slice 20 restored it for the inbound
// adapter and the message cache), verbatim from upstream.
import type { Chat, Message } from "grammy/types";
import { parseStrictPositiveInteger } from "@getpaseo/channels-core/plugin-sdk/number-runtime";
import {
  buildSenderLabel,
  buildSenderName,
  extractTelegramLocation,
  getTelegramTextParts,
  hasBotMention,
  isBinaryContent,
  joinTelegramTextParts,
  normalizeForwardedContext,
  resolveTelegramPrimaryMedia,
} from "./body-helpers.js";
import type { TelegramThreadSpec } from "../thread-spec.js";

export type {
  TelegramForwardedContext,
  TelegramMediaKind,
  TelegramTextEntity,
} from "./body-helpers.js";
export type { TelegramThreadSpec } from "../thread-spec.js";
export {
  buildSenderLabel,
  buildSenderName,
  extractTelegramLocation,
  getTelegramTextParts,
  hasBotMention,
  isBinaryContent,
  joinTelegramTextParts,
  normalizeForwardedContext,
  resolveTelegramPrimaryMedia,
};

export const TELEGRAM_GENERAL_TOPIC_ID = 1;

type TelegramThreadParams = {
  direct_messages_topic_id?: number;
  message_thread_id?: number;
};

export function resolveTelegramMessageForumFlagHint(params: {
  chatType?: Chat["type"];
  isForum?: boolean;
  isTopicMessage?: boolean;
}): boolean | undefined {
  if (params.chatType === "supergroup" && params.isTopicMessage === true) {
    return true;
  }
  return typeof params.isForum === "boolean" ? params.isForum : undefined;
}

/**
 * Resolve the thread ID for Telegram forum topics.
 * For non-forum groups, returns undefined even if messageThreadId is present
 * (reply threads in regular groups should not create separate sessions).
 * For forum groups, returns the topic ID (or General topic ID=1 if unspecified).
 */
export function resolveTelegramForumThreadId(params: {
  isForum?: boolean;
  messageThreadId?: number | null;
}) {
  // Non-forum groups: ignore message_thread_id (reply threads are not real topics)
  if (!params.isForum) {
    return undefined;
  }
  // Forum groups: use the topic ID, defaulting to General topic
  if (params.messageThreadId == null) {
    return TELEGRAM_GENERAL_TOPIC_ID;
  }
  return params.messageThreadId;
}

export function resolveTelegramThreadSpec(params: {
  isGroup: boolean;
  isForum?: boolean;
  messageThreadId?: number | null;
}): TelegramThreadSpec {
  if (params.isGroup) {
    const id = resolveTelegramForumThreadId({
      isForum: params.isForum,
      messageThreadId: params.messageThreadId,
    });
    return id === undefined ? { scope: "none" } : { id, scope: "forum" };
  }
  if (params.messageThreadId == null) {
    return { scope: "dm" };
  }
  return {
    id: params.messageThreadId,
    scope: "dm",
  };
}

export function resolveTelegramMessageThreadSpec(
  message: Message,
  isForum?: boolean,
): TelegramThreadSpec {
  if (message.chat.is_direct_messages === true) {
    const id = parseStrictPositiveInteger(message.direct_messages_topic?.topic_id);
    return id === undefined ? { scope: "none" } : { id, scope: "direct-messages" };
  }
  const isGroup = message.chat.type === "group" || message.chat.type === "supergroup";
  return resolveTelegramThreadSpec({
    isGroup,
    isForum:
      isForum ??
      resolveTelegramMessageForumFlagHint({
        chatType: message.chat.type,
        isForum: message.chat.is_forum,
        isTopicMessage: message.is_topic_message,
      }),
    messageThreadId: message.message_thread_id,
  });
}

/**
 * Build thread params for Telegram API calls (messages, media).
 *
 * IMPORTANT: Thread IDs behave differently based on chat type:
 * - Bot-private topics: Include message_thread_id when present
 * - Forum topics: Skip thread_id=1 (General topic), include others
 * - Channel Direct Messages topics: Include direct_messages_topic_id
 * - Regular groups: Thread IDs are ignored by Telegram
 */
export function buildTelegramThreadParams(
  thread?: TelegramThreadSpec | null,
): TelegramThreadParams | undefined {
  if (thread?.id == null) {
    return undefined;
  }
  const normalized = Math.trunc(thread.id);

  if (!Number.isFinite(normalized)) {
    return undefined;
  }

  if (thread.scope === "dm") {
    return normalized > 0 ? { message_thread_id: normalized } : undefined;
  }

  if (thread.scope === "direct-messages") {
    return normalized > 0 ? { direct_messages_topic_id: normalized } : undefined;
  }

  if (thread.scope === "none") {
    return undefined;
  }

  // Telegram rejects message_thread_id=1 for General forum topic
  if (normalized === TELEGRAM_GENERAL_TOPIC_ID) {
    return undefined;
  }

  return { message_thread_id: normalized };
}

export function buildTelegramRoutingTarget(
  chatId: number | string,
  thread?: TelegramThreadSpec | null,
): string {
  const base = `telegram:${chatId}`;
  const threadParams = buildTelegramThreadParams(thread);
  if (threadParams?.direct_messages_topic_id != null) {
    return `${base}:direct-topic:${threadParams.direct_messages_topic_id}`;
  }
  return threadParams?.message_thread_id != null
    ? `${base}:topic:${threadParams.message_thread_id}`
    : base;
}

/**
 * Build the canonical Telegram inbound origin used by queued follow-up routing.
 * Bot-private thread ids remain metadata-only; group topic ids must be in-band.
 */
export function buildTelegramInboundOriginTarget(
  chatId: number | string,
  thread?: TelegramThreadSpec | null,
): string {
  if (thread?.scope !== "forum" && thread?.scope !== "direct-messages") {
    return `telegram:${chatId}`;
  }
  return buildTelegramRoutingTarget(chatId, thread);
}

/**
 * Build thread params for typing indicators (sendChatAction).
 * Empirically, General topic (id=1) needs message_thread_id for typing to appear.
 */
export function buildTypingThreadParams(messageThreadId?: number) {
  if (messageThreadId == null) {
    return undefined;
  }
  return { message_thread_id: Math.trunc(messageThreadId) };
}
