import { callTelegramApi } from "./api.ts";
import { TelegramApiError } from "./api.ts";
import { sleep } from "../../infra/process.ts";
import type { TelegramWireFormat } from "./content.ts";

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
    await sleep(delayMs);
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

type TelegramTextPayload = {
  text: string;
  parseMode?: "HTML";
};

function buildTelegramTextPayload(params: {
  text: string;
  wireFormat?: TelegramWireFormat;
}): TelegramTextPayload {
  if (params.wireFormat !== "html") {
    return {
      text: params.text,
    };
  }

  return {
    text: params.text,
    parseMode: "HTML",
  };
}

function isTelegramHtmlParseError(error: unknown) {
  return (
    error instanceof TelegramApiError &&
    error.errorCode === 400 &&
    /can't parse entities|unsupported start tag|unexpected end tag|entity beginning/i.test(
      error.description,
    )
  );
}

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
  wireFormat?: TelegramWireFormat;
}) {
  const posted: TelegramPostedMessageChunk[] = [];
  const rawChunks = splitTelegramText(params.text);

  try {
    for (const chunk of rawChunks) {
      const payload = buildTelegramTextPayload({
        text: chunk,
        wireFormat: params.wireFormat,
      });
      const response = await callTelegramApi<{ message_id: number }>(
        params.token,
        "sendMessage",
        {
          chat_id: params.chatId,
          text: payload.text,
          ...(payload.parseMode ? { parse_mode: payload.parseMode } : {}),
          ...(params.topicId != null && !params.omitThreadId
            ? { message_thread_id: params.topicId }
            : {}),
        },
      );
      posted.push({
        text: payload.text,
        messageId: response.message_id,
      });
    }
  } catch (error) {
    if (params.wireFormat !== "html" || !isTelegramHtmlParseError(error)) {
      throw error;
    }

    for (const chunk of posted) {
      await callTelegramApi(params.token, "deleteMessage", {
        chat_id: params.chatId,
        message_id: chunk.messageId,
      });
      lastTelegramEditAtByMessage.delete(
        getTelegramEditKey({
          token: params.token,
          chatId: params.chatId,
          messageId: chunk.messageId,
        }),
      );
    }
    posted.length = 0;
    for (const chunk of rawChunks) {
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
  wireFormat?: TelegramWireFormat;
}) {
  const rawNextTexts = splitTelegramText(params.text);
  const reconcileWithTexts = async (nextTexts: string[], parseMode?: "HTML") => {
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
            ...(parseMode ? { parse_mode: parseMode } : {}),
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
          ...(parseMode ? { parse_mode: parseMode } : {}),
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
  };

  if (params.wireFormat !== "html") {
    return await reconcileWithTexts(rawNextTexts);
  }

  try {
    const renderedTexts = rawNextTexts.map((text) =>
      buildTelegramTextPayload({
        text,
        wireFormat: params.wireFormat,
      }).text
    );
    return await reconcileWithTexts(renderedTexts, "HTML");
  } catch (error) {
    if (!isTelegramHtmlParseError(error)) {
      throw error;
    }

    return await reconcileWithTexts(rawNextTexts);
  }
}

export function shouldOmitTelegramThreadId(topicId?: number) {
  return topicId === 1;
}

export function getTelegramMaxChars(maxMessageChars: number) {
  return Math.min(maxMessageChars, 3900);
}
