import { basename } from "node:path";
import { downloadRemoteBuffer } from "./download.ts";
import { saveWorkspaceAttachment } from "./storage.ts";

export const DEFAULT_REMOTE_ATTACHMENT_RETRY_DELAYS_MS = [250, 750];

export function isSupportedRemoteAttachmentUrl(rawUrl: string | undefined) {
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

export function inferRemoteAttachmentFilename(url: string, fallbackName: string) {
  try {
    const fileName = basename(new URL(url).pathname);
    return fileName || fallbackName;
  } catch {
    return fallbackName;
  }
}

export function summarizeRemoteAttachmentUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return rawUrl;
  }
}

export async function saveRemoteWorkspaceAttachment(params: {
  url: string;
  workspacePath: string;
  sessionKey: string;
  messageId: string;
  originalFilename: string;
  defaultBaseName: string;
  retryDelaysMs?: number[];
  headers?: Record<string, string>;
}) {
  const retryDelaysMs = params.retryDelaysMs ?? DEFAULT_REMOTE_ATTACHMENT_RETRY_DELAYS_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const downloaded = await downloadRemoteBuffer({
        url: params.url,
        headers: params.headers,
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
      if (attempt >= retryDelaysMs.length) {
        break;
      }
      await Bun.sleep(retryDelaysMs[attempt]!);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`attachment download failed for ${summarizeRemoteAttachmentUrl(params.url)}`);
}
