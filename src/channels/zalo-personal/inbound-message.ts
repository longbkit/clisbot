import type { ZaloPersonalInboundMessage } from "./service-types.ts";
import {
  getZaloPersonalMediaGroupMessages,
  resolveZaloPersonalAttachmentUrls,
  resolveZaloPersonalMediaGroup,
} from "./attachments.ts";

export function getZaloPersonalMessageText(message: ZaloPersonalInboundMessage, ownId?: string) {
  const messages = getZaloPersonalMediaGroupMessages(message);
  const parts = messages
    .map((entry) => normalizeZaloPersonalContent(entry))
    .filter(Boolean);
  const content = parts.join("\n");
  if (messages.length > 1) {
    return content.trim();
  }
  if (!content || !ownId) {
    return content.trim();
  }
  return stripZaloPersonalSelfMentions(content, message, ownId);
}

export function getZaloPersonalMessageId(message: ZaloPersonalInboundMessage) {
  const mediaGroup = resolveZaloPersonalMediaGroup(message);
  const groupMessages = getZaloPersonalMediaGroupMessages(message);
  if (mediaGroup && groupMessages.length > 1) {
    const messageIds = groupMessages
      .map((entry) => String(entry.data.msgId || entry.data.cliMsgId || entry.data.ts || ""))
      .filter(Boolean)
      .join(",");
    return `media-group:${mediaGroup.groupLayoutId}:${messageIds}`;
  }
  return String(message.data.msgId || message.data.cliMsgId || `${message.threadId}:${message.data.ts}`);
}

export function getZaloPersonalMessageSenderId(message: ZaloPersonalInboundMessage) {
  return String(message.data.uidFrom || message.data.userId || message.threadId).trim();
}

export function hasZaloPersonalSelfMention(message: ZaloPersonalInboundMessage, ownId?: string) {
  if (!ownId) {
    return false;
  }
  const mentions = (message.data as unknown as { mentions?: Array<{ uid?: string }> }).mentions ?? [];
  const quoteOwnerId = (message.data as unknown as { quote?: { ownerId?: unknown } }).quote?.ownerId;
  return mentions.some((mention) => mention.uid === ownId) || String(quoteOwnerId || "") === ownId;
}

function normalizeZaloPersonalContent(message: ZaloPersonalInboundMessage) {
  const content = message.data.content;
  if (typeof content === "string") {
    return content;
  }
  if (!content || typeof content !== "object") {
    return "";
  }
  const record = content as Record<string, unknown>;
  const attachmentUrls = new Set(resolveZaloPersonalAttachmentUrls(message));
  const fields = [record.title, record.description, record.href]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .filter((value) => !attachmentUrls.has(value))
    .map((value) => value.trim());
  if (fields.length > 0) {
    return fields.join("\n");
  }
  try {
    return JSON.stringify(content);
  } catch {
    return "";
  }
}

function stripZaloPersonalSelfMentions(
  content: string,
  message: ZaloPersonalInboundMessage,
  ownId: string,
) {
  const mentions = ((message.data as unknown as { mentions?: Array<{ uid?: string; pos?: number; len?: number }> })
    .mentions ?? [])
    .filter((mention) => mention.uid === ownId && Number.isFinite(mention.pos) && Number.isFinite(mention.len))
    .sort((left, right) => (right.pos ?? 0) - (left.pos ?? 0));
  let next = content;
  for (const mention of mentions) {
    const start = Math.max(0, mention.pos ?? 0);
    const end = Math.min(next.length, start + Math.max(0, mention.len ?? 0));
    next = `${next.slice(0, start)} ${next.slice(end)}`;
  }
  return next.replace(/\s+/g, " ").trim();
}
