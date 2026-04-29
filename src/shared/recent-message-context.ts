export const RECENT_CONVERSATION_MESSAGE_LIMIT = 5;

export type StoredRecentConversationMessage = {
  marker: string;
  text?: string;
  senderId?: string;
  senderName?: string;
  senderHandle?: string;
  platform?: "slack" | "telegram";
};

export type StoredRecentConversationState = {
  lastProcessedMarker?: string;
  messages: StoredRecentConversationMessage[];
};

function normalizeMessage(
  message: StoredRecentConversationMessage,
): StoredRecentConversationMessage {
  return {
    marker: message.marker.trim(),
    text: message.text?.trim() || undefined,
    senderId: message.senderId?.trim() || undefined,
    senderName: message.senderName?.trim() || undefined,
    senderHandle: message.senderHandle?.trim() || undefined,
    platform: message.platform,
  };
}

function normalizeReplayLine(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function renderSenderLabel(message: StoredRecentConversationMessage) {
  const rawSenderId = message.senderId?.trim();
  const senderId = rawSenderId && message.platform
    ? `${message.platform}:${message.platform === "slack" ? rawSenderId.toUpperCase() : rawSenderId}`
    : rawSenderId;
  if (!senderId) {
    return message.senderName;
  }
  const details = [senderId, message.senderHandle ? `@${message.senderHandle}` : undefined]
    .filter(Boolean)
    .join(", ");
  return `${message.senderName?.trim() || senderId} [${details}]`;
}

export function appendRecentConversationMessage(
  state: StoredRecentConversationState | undefined,
  message: StoredRecentConversationMessage,
): StoredRecentConversationState {
  const normalized = normalizeMessage(message);
  if (!normalized.marker) {
    return state ?? { messages: [] };
  }

  const currentMessages = state?.messages ?? [];
  const nextMessages = [
    ...currentMessages.filter((entry) => entry.marker !== normalized.marker),
    normalized,
  ].slice(-RECENT_CONVERSATION_MESSAGE_LIMIT);

  return {
    lastProcessedMarker: state?.lastProcessedMarker,
    messages: nextMessages,
  };
}

export function markRecentConversationProcessed(
  state: StoredRecentConversationState | undefined,
  marker: string,
): StoredRecentConversationState {
  const normalizedMarker = marker.trim();
  return {
    lastProcessedMarker: normalizedMarker || state?.lastProcessedMarker,
    messages: state?.messages ?? [],
  };
}

export function collectRecentConversationReplayMessages(
  state: StoredRecentConversationState | undefined,
  params: {
    excludeMarker?: string;
  } = {},
): StoredRecentConversationMessage[] {
  const messages = state?.messages ?? [];
  if (messages.length === 0) {
    return [];
  }

  const excludeMarker = params.excludeMarker?.trim();
  const pending: StoredRecentConversationMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (state?.lastProcessedMarker && message.marker === state.lastProcessedMarker) {
      break;
    }
    if (excludeMarker && message.marker === excludeMarker) {
      continue;
    }
    pending.push(message);
  }

  return pending.reverse();
}

export function prependRecentConversationContext(params: {
  currentText: string;
  recentMessages: StoredRecentConversationMessage[];
}) {
  const replayLines = params.recentMessages
    .map((message) => {
      const text = normalizeReplayLine(message.text ?? "");
      if (!text) {
        return "";
      }

      const sender = renderSenderLabel(message);
      return sender ? `- ${sender}: ${text}` : `- ${text}`;
    })
    .filter(Boolean);

  if (replayLines.length === 0) {
    return params.currentText;
  }

  return [
    "Before answering, catch up on these newer messages from this conversation that were not processed yet:",
    ...replayLines,
    "",
    "Current message:",
    params.currentText,
  ].join("\n");
}
