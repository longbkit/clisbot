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

export type TelegramMessage = {
  message_id: number;
  message_thread_id?: number;
  text?: string;
  caption?: string;
  from?: TelegramUser;
  chat: TelegramChat;
  document?: TelegramFileDocument;
  photo?: TelegramPhotoSize[];
  reply_to_message?: {
    from?: TelegramUser;
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

  const pattern = new RegExp(`(^|\\s)@${escapeRegExp(normalizedBotUsername)}\\b`, "i");
  return pattern.test(text);
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

function escapeRegExp(raw: string) {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
