import { basename } from "node:path";
import { downloadRemoteBuffer } from "../../agents/attachments/download.ts";
import { saveWorkspaceAttachment } from "../../agents/attachments/storage.ts";
import type { ZaloBotMessage } from "./api.ts";

const ZALO_BOT_ATTACHMENT_RETRY_DELAYS_MS = [250, 750];

function isSupportedRemoteAttachmentUrl(rawUrl: string | undefined) {
  if (!rawUrl) {
    return false;
  }

  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function inferAttachmentFilename(url: string, fallbackName: string) {
  try {
    const parsed = new URL(url);
    const fileName = basename(parsed.pathname);
    return fileName || fallbackName;
  } catch {
    return fallbackName;
  }
}

function summarizeAttachmentUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return rawUrl;
  }
}

async function downloadZaloBotAttachment(params: {
  url: string;
  workspacePath: string;
  sessionKey: string;
  messageId: string;
  originalFilename: string;
  defaultBaseName: string;
}) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= ZALO_BOT_ATTACHMENT_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const downloaded = await downloadRemoteBuffer({
        url: params.url,
      });
      return saveWorkspaceAttachment({
        workspacePath: params.workspacePath,
        sessionKey: params.sessionKey,
        messageId: params.messageId,
        buffer: downloaded.buffer,
        originalFilename: params.originalFilename,
        contentType: downloaded.contentType,
        defaultBaseName: params.defaultBaseName,
      });
    } catch (error) {
      lastError = error;
      if (attempt >= ZALO_BOT_ATTACHMENT_RETRY_DELAYS_MS.length) {
        break;
      }
      await Bun.sleep(ZALO_BOT_ATTACHMENT_RETRY_DELAYS_MS[attempt]!);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`zalo-bot attachment download failed for ${summarizeAttachmentUrl(params.url)}`);
}

export async function resolveZaloBotAttachmentPaths(params: {
  message: ZaloBotMessage;
  workspacePath: string;
  sessionKey: string;
  messageId: string;
}) {
  const attachmentPaths: string[] = [];

  if (isSupportedRemoteAttachmentUrl(params.message.photo_url)) {
    try {
      const filePath = await downloadZaloBotAttachment({
        url: params.message.photo_url!,
        workspacePath: params.workspacePath,
        sessionKey: params.sessionKey,
        messageId: params.messageId,
        originalFilename: inferAttachmentFilename(
          params.message.photo_url!,
          "zalo-bot-photo",
        ),
        defaultBaseName: "zalo-bot-photo",
      });
      attachmentPaths.push(filePath);
    } catch (error) {
      console.error("zalo-bot photo download failed", {
        messageId: params.message.message_id,
        url: summarizeAttachmentUrl(params.message.photo_url!),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (isSupportedRemoteAttachmentUrl(params.message.sticker)) {
    try {
      const filePath = await downloadZaloBotAttachment({
        url: params.message.sticker!,
        workspacePath: params.workspacePath,
        sessionKey: params.sessionKey,
        messageId: params.messageId,
        originalFilename: inferAttachmentFilename(
          params.message.sticker!,
          "zalo-bot-sticker",
        ),
        defaultBaseName: "zalo-bot-sticker",
      });
      attachmentPaths.push(filePath);
    } catch (error) {
      console.error("zalo-bot sticker download failed", {
        messageId: params.message.message_id,
        url: summarizeAttachmentUrl(params.message.sticker!),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return attachmentPaths;
}
