export type TelegramUser = {
  id?: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  is_forum?: boolean;
};

export type TelegramFileDocument = {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TelegramPhotoSize = {
  file_id: string;
  file_size?: number;
};

export type TelegramVoice = {
  file_id: string;
  mime_type?: string;
  file_size?: number;
  duration?: number;
};

export type TelegramAudio = {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  duration?: number;
  title?: string;
};

export type TelegramMessage = {
  message_id: number;
  date?: number;
  message_thread_id?: number;
  text?: string;
  caption?: string;
  from?: TelegramUser;
  chat: TelegramChat;
  document?: TelegramFileDocument;
  photo?: TelegramPhotoSize[];
  voice?: TelegramVoice;
  audio?: TelegramAudio;
  forum_topic_created?: {
    name?: string;
  };
  reply_to_message?: {
    from?: TelegramUser;
    forum_topic_created?: {
      name?: string;
    };
  };
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

export function getTelegramUpdateSkipReason(update: TelegramUpdate) {
  if (!update.message) {
    return "no-message";
  }

  if (!update.message.from?.id && !update.message.from?.is_bot) {
    return "missing-user";
  }

  return null;
}

export function hasTelegramBotMention(text: string, botUsername?: string) {
  const normalizedBotUsername = (botUsername ?? "").trim().replace(/^@/, "");
  if (!text || !normalizedBotUsername) {
    return false;
  }

  return extractTelegramMentionTargets(text).includes(normalizedBotUsername.toLowerCase());
}

export function hasForeignTelegramMention(text: string, botUsername?: string) {
  const mentions = extractTelegramMentionTargets(text);
  if (mentions.length === 0) {
    return false;
  }

  const normalizedBotUsername = (botUsername ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!normalizedBotUsername) {
    return true;
  }

  return !mentions.includes(normalizedBotUsername);
}

export function stripTelegramBotMention(text: string, botUsername?: string) {
  const normalizedBotUsername = (botUsername ?? "").trim().replace(/^@/, "");
  if (!normalizedBotUsername) {
    return text.trim();
  }

  const pattern = new RegExp(`(^|\\s)@${escapeRegExp(normalizedBotUsername)}\\b`, "ig");
  return text.replace(pattern, " ").replace(/\s+/g, " ").trim();
}

export function isTelegramBotOriginatedMessage(message: TelegramMessage) {
  return Boolean(message.from?.is_bot);
}

export function isReplyToTelegramBot(message: TelegramMessage, botUserId?: number) {
  return Boolean(botUserId && message.reply_to_message?.from?.id === botUserId);
}

export function resolveTelegramTopicName(message: TelegramMessage) {
  return (
    message.forum_topic_created?.name?.trim() ||
    message.reply_to_message?.forum_topic_created?.name?.trim() ||
    undefined
  );
}

function escapeRegExp(raw: string) {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTelegramMentionTargets(text: string) {
  if (!text) {
    return [];
  }

  const matches = new Set<string>();
  const mentionPattern = /(^|\s)@([A-Za-z0-9_]{2,32})\b/g;
  const slashCommandTargetPattern = /(^|\s)\/[A-Za-z0-9_]+@([A-Za-z0-9_]{2,32})\b/g;

  for (const match of text.matchAll(mentionPattern)) {
    const username = match[2]?.trim().toLowerCase();
    if (username) {
      matches.add(username);
    }
  }

  for (const match of text.matchAll(slashCommandTargetPattern)) {
    const username = match[2]?.trim().toLowerCase();
    if (username) {
      matches.add(username);
    }
  }

  return [...matches];
}
