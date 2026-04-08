import { callTelegramApi } from "./api.ts";

const TELEGRAM_MIN_EDIT_INTERVAL_MS = 4000;
const lastTelegramEditAtByMessage = new Map<string, number>();

function getTelegramEditKey(params: {
  token: string;
  chatId: number;
  messageId: number;
}) {
  return `${params.token}:${params.chatId}:${params.messageId}`;
}

export function getTelegramEditThrottleDelayMs(params: {
  lastEditedAt?: number;
  now?: number;
}) {
  if (typeof params.lastEditedAt !== "number" || !Number.isFinite(params.lastEditedAt)) {
    return 0;
  }
  const now = params.now ?? Date.now();
  const lastEditedAt = params.lastEditedAt;
  return Math.max(0, lastEditedAt + TELEGRAM_MIN_EDIT_INTERVAL_MS - now);
}

async function paceTelegramEdit(params: {
  token: string;
  chatId: number;
  messageId: number;
}) {
  const key = getTelegramEditKey(params);
  const delayMs = getTelegramEditThrottleDelayMs({
    lastEditedAt: lastTelegramEditAtByMessage.get(key),
  });
  if (delayMs > 0) {
    await Bun.sleep(delayMs);
  }
}

function recordTelegramEdit(params: {
  token: string;
  chatId: number;
  messageId: number;
}) {
  lastTelegramEditAtByMessage.set(getTelegramEditKey(params), Date.now());
}

export type TelegramPostedMessageChunk = {
  text: string;
  messageId: number;
};

function splitTelegramText(text: string, maxChars = 3900) {
  if (!text) {
    return [];
  }

  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > maxChars) {
    const breakpoint =
      remaining.lastIndexOf("\n\n", maxChars) > maxChars / 2
        ? remaining.lastIndexOf("\n\n", maxChars)
        : remaining.lastIndexOf("\n", maxChars) > maxChars / 2
          ? remaining.lastIndexOf("\n", maxChars)
          : maxChars;
    const nextChunk = remaining.slice(0, breakpoint).trim();
    if (nextChunk) {
      chunks.push(nextChunk);
    }
    remaining = remaining.slice(breakpoint).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

export async function postTelegramText(params: {
  token: string;
  chatId: number;
  text: string;
  topicId?: number;
  omitThreadId?: boolean;
}) {
  const posted: TelegramPostedMessageChunk[] = [];
  const chunks = splitTelegramText(params.text);

  for (const chunk of chunks) {
    const response = await callTelegramApi<{ message_id: number }>(
      params.token,
      "sendMessage",
      {
        chat_id: params.chatId,
        text: chunk,
        ...(params.topicId != null && !params.omitThreadId
          ? { message_thread_id: params.topicId }
          : {}),
      },
    );
    posted.push({
      text: chunk,
      messageId: response.message_id,
    });
  }

  return posted;
}

export async function reconcileTelegramText(params: {
  token: string;
  chatId: number;
  chunks: TelegramPostedMessageChunk[];
  text: string;
  topicId?: number;
  omitThreadId?: boolean;
}) {
  const nextTexts = splitTelegramText(params.text);
  const reconciled: TelegramPostedMessageChunk[] = [];
  const sharedCount = Math.min(params.chunks.length, nextTexts.length);

  for (let index = 0; index < sharedCount; index += 1) {
    const existingChunk = params.chunks[index];
    const nextText = nextTexts[index];
    if (!existingChunk || !nextText) {
      continue;
    }

    if (existingChunk.text !== nextText) {
      await paceTelegramEdit({
        token: params.token,
        chatId: params.chatId,
        messageId: existingChunk.messageId,
      });
      await callTelegramApi(
        params.token,
        "editMessageText",
        {
          chat_id: params.chatId,
          message_id: existingChunk.messageId,
          text: nextText,
        },
      );
      recordTelegramEdit({
        token: params.token,
        chatId: params.chatId,
        messageId: existingChunk.messageId,
      });
    }

    reconciled.push({
      text: nextText,
      messageId: existingChunk.messageId,
    });
  }

  for (let index = sharedCount; index < nextTexts.length; index += 1) {
    const nextText = nextTexts[index];
    if (!nextText) {
      continue;
    }

    const response = await callTelegramApi<{ message_id: number }>(
      params.token,
      "sendMessage",
      {
        chat_id: params.chatId,
        text: nextText,
        ...(params.topicId != null && !params.omitThreadId
          ? { message_thread_id: params.topicId }
          : {}),
      },
    );
    reconciled.push({
      text: nextText,
      messageId: response.message_id,
    });
  }

  for (let index = nextTexts.length; index < params.chunks.length; index += 1) {
    const staleChunk = params.chunks[index];
    if (!staleChunk) {
      continue;
    }

    await callTelegramApi(params.token, "deleteMessage", {
      chat_id: params.chatId,
      message_id: staleChunk.messageId,
    });
    lastTelegramEditAtByMessage.delete(
      getTelegramEditKey({
        token: params.token,
        chatId: params.chatId,
        messageId: staleChunk.messageId,
      }),
    );
  }

  return reconciled;
}

export function shouldOmitTelegramThreadId(topicId?: number) {
  return topicId === 1;
}

export function getTelegramMaxChars(maxMessageChars: number) {
  return Math.min(maxMessageChars, 3900);
}
