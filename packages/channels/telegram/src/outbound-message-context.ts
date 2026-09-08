// upstream: extensions/telegram/src/outbound-message-context.ts@5d8067a4483
// D-TG-018: upstream records every outbound message into OpenClaw's Telegram
// message cache so the agent's next prompt can see the bot's own turns, and so
// a later delegated mutation of a message the bot itself sent is authorized
// against the topic the provider put it in. Prompt context is Hub-owned in
// Fusion, but the OBSERVATION is not: without it the bot cannot edit or react
// to its own reply inside a forum topic (D-TG-031). The cache write is carried;
// the group-history recorder (upstream's self-history window, Hub-owned here)
// and the session-store-derived cache scope (Fusion keys observations by
// account, `fusion/message-thread-observation.ts`) are not.
import type { Message } from "grammy/types";
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { logVerbose } from "@getpaseo/channels-core/plugin-sdk/runtime-env";
import type { TelegramThreadSpec } from "./bot/helpers.js";
import { recordTelegramMessageObservation } from "./fusion/message-thread-observation.js";
import type { TelegramPromptContextProjection } from "./prompt-context-projection.js";
import { resolveTelegramProviderObservedThreadSpec } from "./provider-thread-proof.js";

type TelegramOutboundPromptContextUser = {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramOutboundPromptContextMessage = {
  message_id?: number;
  chat?: { id?: string | number; type?: string; title?: string; username?: string };
  date?: number;
  from?: TelegramOutboundPromptContextUser;
  sender_chat?: { id?: number; title?: string; username?: string };
  sender_business_bot?: TelegramOutboundPromptContextUser;
  openclaw_prompt_context_timestamp_ms?: number;
  text?: string;
  caption?: string;
  message_thread_id?: number;
  direct_messages_topic?: { topic_id?: number };
};

type TelegramOutboundPromptContextAccount = {
  accountId: string;
  name?: string;
  bot?: { first_name?: string; username?: string };
};

function inferTelegramChatType(chatId: string | number): "private" | "supergroup" {
  return String(chatId).startsWith("-") ? "supergroup" : "private";
}

/** Upstream's `buildTelegramSelfSenderName`, minus the group-history window it
 * lives in: the cached sender name of the bot's own turn. */
function buildSelfSenderName(
  configuredName: string | undefined,
  identity: { first_name?: string; username?: string } | undefined,
): string {
  const name =
    configuredName?.trim() || identity?.first_name?.trim() || identity?.username?.trim() || "bot";
  return `${name} (you)`;
}

function buildOutboundCacheMessage(params: {
  account: TelegramOutboundPromptContextAccount;
  chatId: string | number;
  message: TelegramOutboundPromptContextMessage;
  messageId: number;
  botUserId?: number;
  text?: string;
  messageThreadId?: number;
  promptContextTimestampMs?: number;
}): TelegramOutboundPromptContextMessage {
  const chat = params.message.chat ?? {};
  const text = params.message.text ?? params.message.caption ?? params.text;
  const rawSender = params.message.from;
  const stableSender = params.message.sender_chat ? undefined : rawSender;
  const selfSenderName = buildSelfSenderName(
    params.account.name,
    params.account.bot ?? stableSender,
  );
  return {
    ...params.message,
    message_id: params.messageId,
    ...(params.promptContextTimestampMs !== undefined
      ? { openclaw_prompt_context_timestamp_ms: params.promptContextTimestampMs }
      : {}),
    date:
      typeof params.message.date === "number" && Number.isFinite(params.message.date)
        ? params.message.date
        : Math.floor(Date.now() / 1000),
    chat: {
      id: chat.id ?? params.chatId,
      type: chat.type ?? inferTelegramChatType(params.chatId),
      ...(chat.title ? { title: chat.title } : {}),
      ...(chat.username ? { username: chat.username } : {}),
    },
    // Every message entering here came from this bot. Keep only Telegram's real
    // id/username; sender_chat uses a synthetic compatibility user.
    from: {
      id: params.message.sender_chat ? 0 : (stableSender?.id ?? params.botUserId ?? 0),
      is_bot: true,
      first_name: selfSenderName,
      ...(stableSender?.username ? { username: stableSender.username } : {}),
    },
    ...(text ? { text } : {}),
    ...(params.messageThreadId !== undefined ? { message_thread_id: params.messageThreadId } : {}),
  };
}

/** Records the message the bot just sent as an observation of this account.
 * Returns whether it was recorded, upstream's contract. */
export async function recordOutboundMessageForPromptContext(params: {
  cfg: OpenClawConfig;
  account: TelegramOutboundPromptContextAccount;
  chatId: string | number;
  message: TelegramOutboundPromptContextMessage;
  messageId: number;
  botUserId?: number;
  text?: string;
  messageThreadId?: number;
  /** Effective server-owned thread for the successful provider send. */
  successfulSendThread?: TelegramThreadSpec;
  promptContextTimestampMs?: number;
  promptContextProjection?: TelegramPromptContextProjection;
  /** Pre-resolved account owner from the active Telegram runtime. */
  ownerAgentId?: string;
  /** Edits refresh an existing cache entry without inserting another self-history turn. */
  recordGroupHistory?: boolean;
}): Promise<boolean> {
  try {
    const providerObservedThread = resolveTelegramProviderObservedThreadSpec({
      message: params.message,
      ...(params.successfulSendThread ? { successfulSendThread: params.successfulSendThread } : {}),
    });
    const messageThreadId = providerObservedThread?.id ?? params.messageThreadId;
    const cacheMessage = buildOutboundCacheMessage({
      ...params,
      ...(messageThreadId !== undefined ? { messageThreadId } : {}),
    });
    await recordTelegramMessageObservation({
      accountId: params.account.accountId,
      chatId: params.chatId,
      msg: cacheMessage as Message,
      ...(params.botUserId !== undefined ? { botUserId: params.botUserId } : {}),
      ...(params.promptContextProjection
        ? { promptContextProjection: params.promptContextProjection }
        : {}),
      ...(providerObservedThread ? { providerObservedThread } : {}),
      ...(messageThreadId !== undefined ? { threadId: messageThreadId } : {}),
    });
    return true;
  } catch (error) {
    logVerbose(`telegram: failed to record outbound message context: ${String(error)}`);
    return false;
  }
}
