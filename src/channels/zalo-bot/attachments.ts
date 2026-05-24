import {
  inferRemoteAttachmentFilename,
  isSupportedRemoteAttachmentUrl,
  saveRemoteWorkspaceAttachment,
  summarizeRemoteAttachmentUrl,
} from "../../agents/attachments/remote.ts";
import type { ZaloBotMessage } from "./api.ts";

async function downloadZaloBotAttachment(params: {
  url: string;
  workspacePath: string;
  sessionKey: string;
  messageId: string;
  originalFilename: string;
  defaultBaseName: string;
}) {
  return saveRemoteWorkspaceAttachment(params);
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
        originalFilename: inferRemoteAttachmentFilename(
          params.message.photo_url!,
          "zalo-bot-photo",
        ),
        defaultBaseName: "zalo-bot-photo",
      });
      attachmentPaths.push(filePath);
    } catch (error) {
      console.error("zalo-bot photo download failed", {
        messageId: params.message.message_id,
        url: summarizeRemoteAttachmentUrl(params.message.photo_url!),
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
        originalFilename: inferRemoteAttachmentFilename(
          params.message.sticker!,
          "zalo-bot-sticker",
        ),
        defaultBaseName: "zalo-bot-sticker",
      });
      attachmentPaths.push(filePath);
    } catch (error) {
      console.error("zalo-bot sticker download failed", {
        messageId: params.message.message_id,
        url: summarizeRemoteAttachmentUrl(params.message.sticker!),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return attachmentPaths;
}
