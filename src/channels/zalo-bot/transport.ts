import {
  sendZaloBotMessage,
  sendZaloBotPhoto,
} from "./api.ts";
import { resolveZaloBotMessageContent } from "./content.ts";
import type { MessageInputFormat, MessageRenderMode } from "../message/message-command.ts";

export type ZaloBotPostedMessageChunk = {
  text: string;
  messageId?: string;
};

export function chunkZaloBotText(text: string, maxChars = 2000) {
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
    const chunk = remaining.slice(0, breakpoint).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(breakpoint).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

export async function postZaloBotText(params: {
  token: string;
  chatId: string;
  text: string;
  inputFormat?: MessageInputFormat;
  renderMode?: MessageRenderMode;
}) {
  const chunks = chunkZaloBotText(
    resolveZaloBotMessageContent({
      text: params.text,
      inputFormat: params.inputFormat ?? "md",
      renderMode: params.renderMode ?? "native",
    }).text,
  );
  const posted: ZaloBotPostedMessageChunk[] = [];
  for (const chunk of chunks) {
    const response = await sendZaloBotMessage({
      token: params.token,
      chatId: params.chatId,
      text: chunk,
    });
    posted.push({
      text: chunk,
      messageId: response.message_id,
    });
  }
  return posted;
}

export async function reconcileZaloBotText(params: {
  token: string;
  chatId: string;
  chunks: ZaloBotPostedMessageChunk[];
  text: string;
}) {
  return await postZaloBotText({
    token: params.token,
    chatId: params.chatId,
    text: params.text,
  });
}

export async function postZaloBotPhoto(params: {
  token: string;
  chatId: string;
  photoUrl: string;
  caption?: string;
}) {
  return await sendZaloBotPhoto({
    token: params.token,
    chatId: params.chatId,
    photoUrl: params.photoUrl,
    caption: params.caption?.slice(0, 2000),
  });
}
