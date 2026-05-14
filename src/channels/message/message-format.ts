import type { MessageInputFormat, MessageRenderMode } from "./message-command.ts";

export const DEFAULT_MESSAGE_INPUT_FORMAT: MessageInputFormat = "md";
export const DEFAULT_MESSAGE_RENDER_MODE: MessageRenderMode = "native";

export const MESSAGE_INPUT_FORMATS = [
  "plain",
  "md",
  "html",
  "mrkdwn",
  "blocks",
] as const satisfies readonly MessageInputFormat[];

export const MESSAGE_RENDER_MODES = [
  "native",
  "none",
  "html",
  "mrkdwn",
  "blocks",
] as const satisfies readonly MessageRenderMode[];

export function parseMessageInputFormat(raw?: string): MessageInputFormat {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_MESSAGE_INPUT_FORMAT;
  }
  if (MESSAGE_INPUT_FORMATS.includes(normalized as MessageInputFormat)) {
    return normalized as MessageInputFormat;
  }
  throw new Error(`--input must be one of: ${MESSAGE_INPUT_FORMATS.join(", ")}`);
}

export function parseMessageRenderMode(raw?: string): MessageRenderMode {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_MESSAGE_RENDER_MODE;
  }
  if (MESSAGE_RENDER_MODES.includes(normalized as MessageRenderMode)) {
    return normalized as MessageRenderMode;
  }
  throw new Error(`--render must be one of: ${MESSAGE_RENDER_MODES.join(", ")}`);
}
