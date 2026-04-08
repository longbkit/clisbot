import { basename } from "node:path";
import { downloadRemoteBuffer } from "../../agents/attachments/download.ts";
import { saveWorkspaceAttachment } from "../../agents/attachments/storage.ts";
import { callTelegramApi } from "./api.ts";
import type { TelegramFileDocument, TelegramMessage, TelegramPhotoSize } from "./message.ts";

type TelegramGetFileResult = {
  file_path?: string;
};

function pickTelegramPhoto(photo: TelegramPhotoSize[] | undefined) {
  if (!Array.isArray(photo) || photo.length === 0) {
    return undefined;
  }

  return [...photo].sort((left, right) => (right.file_size ?? 0) - (left.file_size ?? 0))[0];
}

async function downloadTelegramAttachment(params: {
  botToken: string;
  fileId: string;
  workspacePath: string;
  sessionKey: string;
  messageId: string;
  originalFilename?: string;
  contentType?: string;
  defaultBaseName: string;
}) {
  const fileInfo = await callTelegramApi<TelegramGetFileResult>(
    params.botToken,
    "getFile",
    {
      file_id: params.fileId,
    },
  );
  if (!fileInfo.file_path) {
    return null;
  }

  const fileUrl = `https://api.telegram.org/file/bot${params.botToken}/${fileInfo.file_path}`;
  const downloaded = await downloadRemoteBuffer({ url: fileUrl });
  return saveWorkspaceAttachment({
    workspacePath: params.workspacePath,
    sessionKey: params.sessionKey,
    messageId: params.messageId,
    buffer: downloaded.buffer,
    originalFilename:
      params.originalFilename || basename(fileInfo.file_path),
    contentType: downloaded.contentType ?? params.contentType,
    defaultBaseName: params.defaultBaseName,
  });
}

export async function resolveTelegramAttachmentPaths(params: {
  message: TelegramMessage;
  botToken: string;
  workspacePath: string;
  sessionKey: string;
  messageId: string;
}) {
  const attachmentPaths: string[] = [];

  const document = params.message.document;
  if (document?.file_id) {
    try {
      const filePath = await downloadTelegramAttachment({
        botToken: params.botToken,
        fileId: document.file_id,
        workspacePath: params.workspacePath,
        sessionKey: params.sessionKey,
        messageId: params.messageId,
        originalFilename: document.file_name,
        contentType: document.mime_type,
        defaultBaseName: "telegram-document",
      });
      if (filePath) {
        attachmentPaths.push(filePath);
      }
    } catch (error) {
      console.error("telegram document download failed", error);
    }
  }

  const photo = pickTelegramPhoto(params.message.photo);
  if (photo?.file_id) {
    try {
      const filePath = await downloadTelegramAttachment({
        botToken: params.botToken,
        fileId: photo.file_id,
        workspacePath: params.workspacePath,
        sessionKey: params.sessionKey,
        messageId: params.messageId,
        defaultBaseName: "telegram-photo",
      });
      if (filePath) {
        attachmentPaths.push(filePath);
      }
    } catch (error) {
      console.error("telegram photo download failed", error);
    }
  }

  return attachmentPaths;
}
