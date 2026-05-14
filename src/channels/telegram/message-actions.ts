import { basename, extname } from "node:path";
import { readFile } from "node:fs/promises";
import { callTelegramApi } from "./api.ts";
import { TelegramApiError } from "./api.ts";
import { resolveTelegramMessageContent } from "./content.ts";
import type { MessageInputFormat, MessageRenderMode } from "../message/message-command.ts";

export type TelegramMessageActionParams = {
  botToken: string;
  target: string;
  threadId?: string;
  replyTo?: string;
  message?: string;
  media?: string;
  messageId?: string;
  emoji?: string;
  remove?: boolean;
  limit?: number;
  query?: string;
  pollQuestion?: string;
  pollOptions?: string[];
  forceDocument?: boolean;
  silent?: boolean;
  inputFormat?: MessageInputFormat;
  renderMode?: MessageRenderMode;
};

function isTelegramHtmlParseError(error: unknown) {
  return (
    error instanceof TelegramApiError &&
    error.errorCode === 400 &&
    /can't parse entities|unsupported start tag|unexpected end tag|entity beginning/i.test(
      error.description,
    )
  );
}

function buildTelegramMessagePayload(params: {
  text?: string;
  inputFormat?: MessageInputFormat;
  renderMode?: MessageRenderMode;
}) {
  if (!params.text) {
    return null;
  }
  const resolved = resolveTelegramMessageContent({
    text: params.text,
    inputFormat: params.inputFormat ?? "md",
    renderMode: params.renderMode ?? "native",
  });

  return {
    text: resolved.text,
    parse_mode: resolved.wireFormat === "html" ? ("HTML" as const) : undefined,
  };
}

function parseTelegramChatId(raw: string) {
  const value = raw.trim();
  if (value.startsWith("@")) {
    return value;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  throw new Error(`Invalid Telegram target: ${raw}`);
}

function parseTelegramThreadId(threadId?: string) {
  const raw = threadId?.trim();
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function loadTelegramMedia(media: string) {
  if (/^https?:\/\//i.test(media)) {
    const url = new URL(media);
    return {
      filename: basename(url.pathname) || "attachment",
      remoteUrl: media,
    };
  }

  return {
    filename: basename(media),
    file: new Blob([await readFile(media)]),
  };
}

function inferTelegramMediaKind(filename: string, forceDocument?: boolean) {
  const extension = extname(filename).toLowerCase();
  if (forceDocument) {
    return "document" as const;
  }
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(extension)) {
    return "photo" as const;
  }
  if ([".gif"].includes(extension)) {
    return "animation" as const;
  }
  if ([".mp4", ".mov", ".mkv"].includes(extension)) {
    return "video" as const;
  }
  if ([".mp3", ".m4a", ".wav", ".ogg"].includes(extension)) {
    return "audio" as const;
  }
  return "document" as const;
}

async function callTelegramMultipartApi<TResult>(params: {
  token: string;
  method: string;
  payload: Record<string, string | number | boolean>;
  fileField: string;
  file: Blob;
  filename: string;
}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(params.payload)) {
    form.set(key, String(value));
  }
  form.set(params.fileField, params.file, params.filename);
  const response = await fetch(`https://api.telegram.org/bot${params.token}/${params.method}`, {
    method: "POST",
    body: form,
  });
  const payload = (await response.json()) as { ok?: boolean; result?: TResult; description?: string };
  if (!payload.ok) {
    throw new Error(`telegram ${params.method} failed: ${payload.description ?? "unknown error"}`);
  }
  return payload.result as TResult;
}

export async function sendTelegramMessage(params: TelegramMessageActionParams) {
  const chatId = parseTelegramChatId(params.target);
  const threadId = parseTelegramThreadId(params.threadId);
  const replyTo = params.replyTo ? Number(params.replyTo) : undefined;
  const formattedMessage = buildTelegramMessagePayload({
    text: params.message,
    inputFormat: params.inputFormat,
    renderMode: params.renderMode,
  });

  if (params.media) {
    const media = await loadTelegramMedia(params.media);
    const kind = inferTelegramMediaKind(media.filename, params.forceDocument);
    const methodByKind = {
      photo: "sendPhoto",
      animation: "sendAnimation",
      video: "sendVideo",
      audio: "sendAudio",
      document: "sendDocument",
    } as const;
    const fieldByKind = {
      photo: "photo",
      animation: "animation",
      video: "video",
      audio: "audio",
      document: "document",
    } as const;
    const method = methodByKind[kind];
    const fileField = fieldByKind[kind];
    const payload = {
      chat_id: chatId,
      ...(formattedMessage ? { caption: formattedMessage.text } : {}),
      ...(formattedMessage?.parse_mode ? { parse_mode: formattedMessage.parse_mode } : {}),
      ...(threadId != null && threadId !== 1 ? { message_thread_id: threadId } : {}),
      ...(replyTo != null ? { reply_to_message_id: replyTo } : {}),
      ...(params.silent ? { disable_notification: true } : {}),
    };
    try {
      if (media.remoteUrl) {
        return await callTelegramApi(params.botToken, method, {
          ...payload,
          [fileField]: media.remoteUrl,
        });
      }
      return await callTelegramMultipartApi({
        token: params.botToken,
        method,
        payload,
        fileField,
        file: media.file!,
        filename: media.filename,
      });
    } catch (error) {
      if (!formattedMessage || !isTelegramHtmlParseError(error)) {
        throw error;
      }

      const plainPayload: Record<string, string | number | boolean> = {
        ...payload,
        caption: params.message ?? "",
      };
      delete (plainPayload as { parse_mode?: string }).parse_mode;

      if (media.remoteUrl) {
        return await callTelegramApi(params.botToken, method, {
          ...plainPayload,
          [fileField]: media.remoteUrl,
        });
      }
      return await callTelegramMultipartApi({
        token: params.botToken,
        method,
        payload: plainPayload,
        fileField,
        file: media.file!,
        filename: media.filename,
      });
    }
  }

  const payload = {
    chat_id: chatId,
    text: formattedMessage?.text ?? params.message ?? "",
    ...(formattedMessage?.parse_mode ? { parse_mode: formattedMessage.parse_mode } : {}),
    ...(threadId != null && threadId !== 1 ? { message_thread_id: threadId } : {}),
    ...(replyTo != null ? { reply_to_message_id: replyTo } : {}),
    ...(params.silent ? { disable_notification: true } : {}),
  };
  try {
    return await callTelegramApi(params.botToken, "sendMessage", payload);
  } catch (error) {
    if (!formattedMessage || !isTelegramHtmlParseError(error)) {
      throw error;
    }

    const plainPayload = {
      ...payload,
      text: params.message ?? "",
    };
    delete (plainPayload as { parse_mode?: string }).parse_mode;
    return await callTelegramApi(params.botToken, "sendMessage", plainPayload);
  }
}

export async function sendTelegramPoll(params: TelegramMessageActionParams) {
  if (!params.pollQuestion || !params.pollOptions?.length) {
    throw new Error("--poll-question and --poll-option are required");
  }
  return await callTelegramApi(params.botToken, "sendPoll", {
    chat_id: parseTelegramChatId(params.target),
    question: params.pollQuestion,
    options: params.pollOptions,
    ...(params.silent ? { disable_notification: true } : {}),
    ...(parseTelegramThreadId(params.threadId) != null &&
      parseTelegramThreadId(params.threadId) !== 1
      ? { message_thread_id: parseTelegramThreadId(params.threadId) }
      : {}),
  });
}

export async function editTelegramMessage(params: TelegramMessageActionParams) {
  if (!params.messageId || !params.message) {
    throw new Error("--message-id and --message are required");
  }
  const formattedMessage = buildTelegramMessagePayload({
    text: params.message,
    inputFormat: params.inputFormat,
    renderMode: params.renderMode,
  });
  const payload = {
    chat_id: parseTelegramChatId(params.target),
    message_id: Number(params.messageId),
    text: formattedMessage?.text ?? params.message,
    ...(formattedMessage?.parse_mode ? { parse_mode: formattedMessage.parse_mode } : {}),
  };
  try {
    return await callTelegramApi(params.botToken, "editMessageText", payload);
  } catch (error) {
    if (!formattedMessage || !isTelegramHtmlParseError(error)) {
      throw error;
    }

    const plainPayload = {
      ...payload,
      text: params.message,
    };
    delete (plainPayload as { parse_mode?: string }).parse_mode;
    return await callTelegramApi(params.botToken, "editMessageText", plainPayload);
  }
}

export async function deleteTelegramMessageAction(params: TelegramMessageActionParams) {
  if (!params.messageId) {
    throw new Error("--message-id is required");
  }
  return await callTelegramApi(params.botToken, "deleteMessage", {
    chat_id: parseTelegramChatId(params.target),
    message_id: Number(params.messageId),
  });
}

export async function reactTelegramMessage(params: TelegramMessageActionParams) {
  if (!params.messageId) {
    throw new Error("--message-id is required");
  }
  return await callTelegramApi(params.botToken, "setMessageReaction", {
    chat_id: parseTelegramChatId(params.target),
    message_id: Number(params.messageId),
    reaction: params.remove || !params.emoji
      ? []
      : [{ type: "emoji", emoji: params.emoji }],
  });
}

export async function pinTelegramMessage(params: TelegramMessageActionParams) {
  if (!params.messageId) {
    throw new Error("--message-id is required");
  }
  return await callTelegramApi(params.botToken, "pinChatMessage", {
    chat_id: parseTelegramChatId(params.target),
    message_id: Number(params.messageId),
    ...(params.silent ? { disable_notification: true } : {}),
  });
}

export async function unpinTelegramMessage(params: TelegramMessageActionParams) {
  return await callTelegramApi(params.botToken, "unpinChatMessage", {
    chat_id: parseTelegramChatId(params.target),
    ...(params.messageId ? { message_id: Number(params.messageId) } : {}),
  });
}

export async function listTelegramPins(params: TelegramMessageActionParams) {
  const chat = await callTelegramApi<{
    pinned_message?: unknown;
  }>(params.botToken, "getChat", {
    chat_id: parseTelegramChatId(params.target),
  });
  return {
    ok: true,
    pinnedMessages: chat.pinned_message ? [chat.pinned_message] : [],
  };
}

export async function unsupportedTelegramHistoryAction(action: string) {
  throw new Error(`Telegram ${action} is not supported by the current Bot API integration in clisbot.`);
}
