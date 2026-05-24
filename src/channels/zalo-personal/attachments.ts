import {
  inferRemoteAttachmentFilename,
  isSupportedRemoteAttachmentUrl,
  saveRemoteWorkspaceAttachment,
  summarizeRemoteAttachmentUrl,
} from "../../agents/attachments/remote.ts";
import type { ZaloPersonalInboundMessage, ZaloPersonalSingleInboundMessage } from "./service-types.ts";

export type ZaloPersonalMediaGroup = {
  groupLayoutId: string;
  idInGroup: number;
  totalItemInGroup: number;
};

const ZALO_PERSONAL_ATTACHMENT_MSG_TYPES = new Set([
  "chat.gif",
  "chat.photo",
  "chat.video.msg",
  "chat.voice",
  "share.file",
]);
function getZaloPersonalAttachmentUrl(message: ZaloPersonalSingleInboundMessage) {
  const content = message.data.content;
  if (!content || typeof content !== "object") {
    return undefined;
  }
  const record = content as Record<string, unknown>;
  return [record.href, record.fileUrl, record.normalUrl, record.hdUrl]
    .find((value): value is string =>
      typeof value === "string" && isSupportedRemoteAttachmentUrl(value)
    );
}

function resolveDefaultBaseName(message: ZaloPersonalSingleInboundMessage) {
  switch (message.data.msgType) {
    case "chat.gif":
      return "zalo-personal-gif";
    case "chat.photo":
      return "zalo-personal-photo";
    case "chat.video.msg":
      return "zalo-personal-video";
    case "chat.voice":
      return "zalo-personal-voice";
    case "share.file":
      return "zalo-personal-file";
    default:
      return "zalo-personal-attachment";
  }
}

function resolveOriginalFilename(message: ZaloPersonalSingleInboundMessage, url: string) {
  const content = message.data.content;
  const title = content && typeof content === "object"
    ? (content as Record<string, unknown>).title
    : undefined;
  const fallbackName = resolveDefaultBaseName(message);
  return message.data.msgType === "share.file" && typeof title === "string" && title.trim()
    ? title.trim()
    : inferRemoteAttachmentFilename(url, fallbackName);
}

export function resolveZaloPersonalAttachmentUrls(message: ZaloPersonalInboundMessage) {
  return getZaloPersonalMediaGroupMessages(message)
    .flatMap((entry) => resolveZaloPersonalSingleAttachmentUrls(entry));
}

export function getZaloPersonalMediaGroupMessages(
  message: ZaloPersonalInboundMessage,
): ZaloPersonalSingleInboundMessage[] {
  return message.mediaGroupMessages?.length ? message.mediaGroupMessages : [message];
}

function resolveZaloPersonalSingleAttachmentUrls(message: ZaloPersonalSingleInboundMessage) {
  if (!ZALO_PERSONAL_ATTACHMENT_MSG_TYPES.has(message.data.msgType)) {
    return [];
  }
  const url = getZaloPersonalAttachmentUrl(message);
  return url ? [url] : [];
}

export function resolveZaloPersonalMediaGroup(message: ZaloPersonalInboundMessage): ZaloPersonalMediaGroup | undefined {
  if (message.data.msgType !== "chat.photo") {
    return undefined;
  }
  const params = parseContentParams(message);
  const groupLayoutId = toStringValue(params?.group_layout_id);
  const idInGroup = toInteger(params?.id_in_group);
  const totalItemInGroup = toInteger(params?.total_item_in_group);
  if (!groupLayoutId || idInGroup === undefined || !totalItemInGroup || totalItemInGroup < 2) {
    return undefined;
  }
  return { groupLayoutId, idInGroup, totalItemInGroup };
}

export async function resolveZaloPersonalAttachmentPaths(params: {
  message: ZaloPersonalInboundMessage;
  workspacePath: string;
  sessionKey: string;
  messageId: string;
}) {
  const attachmentPaths: string[] = [];
  for (const message of getZaloPersonalMediaGroupMessages(params.message)) {
    const urls = resolveZaloPersonalSingleAttachmentUrls(message);
    const messageId = getMessageLogId(message);
    for (const url of urls) {
      try {
        const filePath = await saveRemoteWorkspaceAttachment({
          url,
          workspacePath: params.workspacePath,
          sessionKey: params.sessionKey,
          messageId: params.messageId,
          originalFilename: resolveOriginalFilename(message, url),
          defaultBaseName: resolveDefaultBaseName(message),
        });
        attachmentPaths.push(filePath);
      } catch (error) {
        console.error("zalo-personal attachment download failed", {
          messageId,
          url: summarizeRemoteAttachmentUrl(url),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return attachmentPaths;
}

function getMessageLogId(message: ZaloPersonalInboundMessage) {
  return String(message.data.msgId || message.data.cliMsgId || message.threadId);
}

function parseContentParams(message: ZaloPersonalInboundMessage) {
  const content = message.data.content;
  if (!content || typeof content !== "object") {
    return undefined;
  }
  const params = (content as Record<string, unknown>).params;
  if (typeof params !== "string") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(params);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function toStringValue(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return typeof value === "number" && Number.isFinite(value) ? String(Math.trunc(value)) : undefined;
}

function toInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}
