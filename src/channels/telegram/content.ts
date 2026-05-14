import type { MessageInputFormat, MessageRenderMode } from "../message/message-command.ts";
import { renderTelegramHtmlSafeFromMarkdown } from "./html-safe.ts";

export type TelegramWireFormat = "text" | "html";

export type TelegramResolvedMessageContent = {
  text: string;
  wireFormat: TelegramWireFormat;
};

export function resolveTelegramMessageContent(params: {
  text: string;
  inputFormat: MessageInputFormat;
  renderMode: MessageRenderMode;
}): TelegramResolvedMessageContent {
  const { text, inputFormat, renderMode } = params;

  if (inputFormat === "blocks" || renderMode === "blocks") {
    throw new Error("Telegram does not support block payloads");
  }
  if (inputFormat === "mrkdwn" || renderMode === "mrkdwn") {
    throw new Error("Telegram does not support Slack mrkdwn payloads");
  }

  if (inputFormat === "html") {
    if (renderMode !== "none" && renderMode !== "html" && renderMode !== "native") {
      throw new Error("Telegram HTML input supports only --render none, html, or native");
    }
    return {
      text,
      wireFormat: "html",
    };
  }

  if (renderMode === "html") {
    return {
      text: renderTelegramHtmlSafeFromMarkdown(text),
      wireFormat: "html",
    };
  }

  if (renderMode === "none" || inputFormat === "plain") {
    return {
      text,
      wireFormat: "text",
    };
  }

  return {
    text: renderTelegramHtmlSafeFromMarkdown(text),
    wireFormat: "html",
  };
}
