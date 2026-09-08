// upstream: extensions/telegram/src/message-topic-binding.ts@5d8067a4483
// D-TG-031: the last step of a delegated topic mutation reads the *provider
// observation* of the message being mutated — upstream loads its file-backed
// Telegram message cache (`./message-cache.js`, 1022 lines over the OpenClaw
// session store) and asks whether that message was observed inbound in the same
// forum topic. Fusion has no inbound message cache yet: inbound parity, and the
// observation it records, is goal slice 20. Everything upstream decides before
// that read is carried verbatim — direct-operator bypass, requester-account
// match, exact-chat match, the thread-context rules and the server-owned
// current-message shortcut — and the missing observation is answered by
// `./fusion/message-thread-observation.js`, which reports "not observed" until
// slice 20 installs the cache. The effect is upstream's own deny branch: a
// delegated mutation of an *earlier* message in a forum topic is refused rather
// than allowed on an unattested chat id.
import {
  normalizeAccountId,
  normalizeOptionalAccountId,
} from "@getpaseo/channels-core/plugin-sdk/account-resolution";
import type {
  ChannelMessageActionContext,
  ChannelThreadingToolContext,
} from "@getpaseo/channels-core/plugin-sdk/channel-contract";
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { parseStrictPositiveInteger } from "@getpaseo/channels-core/plugin-sdk/number-runtime";
import { resolveDefaultTelegramAccountId } from "./accounts.js";
import { hasProviderObservedTelegramThreadBinding } from "./fusion/message-thread-observation.js";
import { parseTelegramTarget } from "./targets.js";

type ConversationReadInvocationOrigin = NonNullable<
  ChannelMessageActionContext["conversationReadOrigin"]
>;

export type TelegramMessageMutationContext = {
  conversationReadOrigin?: ConversationReadInvocationOrigin;
  requesterAccountId?: string | null;
  toolContext?: ChannelThreadingToolContext;
};

const TOPIC_BINDING_ERROR =
  "Delegated Telegram message mutation requires a provider-observed binding to the exact current topic and account.";
const CONVERSATION_BINDING_ERROR =
  "Delegated Telegram conversation read requires the exact current chat and account.";

function rejectUnboundTopicMutation(): never {
  throw new Error(TOPIC_BINDING_ERROR);
}

type CurrentTelegramConversation = {
  hasThreadContext: boolean;
  matchesChat: boolean;
  threadId?: number;
};

function resolveCurrentTelegramConversation(
  toolContext: ChannelThreadingToolContext | undefined,
  chatId: string,
): CurrentTelegramConversation {
  if (toolContext?.currentChannelProvider?.trim().toLowerCase() !== "telegram") {
    return { hasThreadContext: false, matchesChat: false };
  }
  const targets = [toolContext.currentChannelId, toolContext.currentMessagingTarget].filter(
    (value): value is string => typeof value === "string" && Boolean(value.trim()),
  );
  const parsedTargets = targets.map((value) => parseTelegramTarget(value));
  const threadIds = [
    ...parsedTargets.map((target) => target.messageThreadId),
    parseStrictPositiveInteger(toolContext.currentThreadTs),
  ].filter((value): value is number => value !== undefined);
  const threadId = threadIds[0];
  const matchesChat =
    targets.length > 0 &&
    parsedTargets.every((target) => target.chatId === chatId) &&
    (threadId === undefined || threadIds.every((value) => value === threadId));
  return {
    hasThreadContext: threadIds.length > 0,
    matchesChat,
    ...(threadId !== undefined ? { threadId } : {}),
  };
}

function resolveMatchingTelegramRequesterAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  context?: TelegramMessageMutationContext;
}): string | undefined {
  const accountId = normalizeOptionalAccountId(
    params.accountId ?? resolveDefaultTelegramAccountId(params.cfg),
  );
  const requesterAccountId = normalizeOptionalAccountId(params.context?.requesterAccountId);
  return accountId &&
    requesterAccountId &&
    normalizeAccountId(accountId) === normalizeAccountId(requesterAccountId)
    ? accountId
    : undefined;
}

export function resolveTelegramConversationReadChatId(params: {
  chatId?: string | number;
  cfg: OpenClawConfig;
  accountId?: string | null;
  context?: TelegramMessageMutationContext;
}): string {
  const currentTarget =
    params.context?.toolContext?.currentChannelId ??
    params.context?.toolContext?.currentMessagingTarget;
  const requestedTarget = params.chatId ?? currentTarget;
  if (requestedTarget == null || !String(requestedTarget).trim()) {
    throw new Error("Telegram emoji-list requires a chatId or current Telegram conversation.");
  }
  const target = parseTelegramTarget(String(requestedTarget));
  if (params.context?.conversationReadOrigin === "direct-operator") {
    return target.chatId;
  }
  const currentConversation = resolveCurrentTelegramConversation(
    params.context?.toolContext,
    target.chatId,
  );
  if (
    !resolveMatchingTelegramRequesterAccount(params) ||
    !currentConversation.matchesChat ||
    (target.messageThreadId !== undefined &&
      target.messageThreadId !== currentConversation.threadId)
  ) {
    throw new Error(CONVERSATION_BINDING_ERROR);
  }
  return target.chatId;
}

export async function resolveTelegramMessageMutationChatId(params: {
  chatId: string | number;
  messageId: number;
  cfg: OpenClawConfig;
  accountId?: string | null;
  context?: TelegramMessageMutationContext;
}): Promise<string | number> {
  const target = parseTelegramTarget(String(params.chatId));
  if (params.context?.conversationReadOrigin === "direct-operator") {
    return target.messageThreadId === undefined ? params.chatId : target.chatId;
  }

  const currentConversation = resolveCurrentTelegramConversation(
    params.context?.toolContext,
    target.chatId,
  );
  const selectedAccountId = resolveMatchingTelegramRequesterAccount(params);
  if (!selectedAccountId || !currentConversation.matchesChat) {
    return rejectUnboundTopicMutation();
  }

  const threadId = target.messageThreadId ?? currentConversation.threadId;
  if (threadId === undefined && !currentConversation.hasThreadContext) {
    return target.chatId;
  }
  if (threadId === undefined || currentConversation.threadId !== threadId) {
    return rejectUnboundTopicMutation();
  }

  const currentMessageId = parseStrictPositiveInteger(
    params.context?.toolContext?.currentMessageId,
  );
  // Current-message context is server-owned. Earlier messages need the
  // persisted provider observation so a sibling topic cannot borrow the ID.
  if (currentMessageId === params.messageId) {
    return target.chatId;
  }

  const observed = await hasProviderObservedTelegramThreadBinding({
    accountId: selectedAccountId,
    chatId: target.chatId,
    messageId: String(params.messageId),
    threadId,
  });
  if (!observed) {
    return rejectUnboundTopicMutation();
  }
  return target.chatId;
}
