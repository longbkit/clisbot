import { access } from "node:fs/promises";
import { extname, join } from "node:path";
import { ensureDir, sanitizeSessionName } from "../../shared/paths.ts";

const CONTENT_TYPE_EXTENSION_MAP: Record<string, string> = {
  "application/json": ".json",
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "text/csv": ".csv",
  "text/markdown": ".md",
  "text/plain": ".txt",
  "text/x-markdown": ".md",
};

function extensionFromContentType(contentType?: string) {
  const normalized = contentType?.split(";")[0]?.trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  return CONTENT_TYPE_EXTENSION_MAP[normalized] ?? "";
}

function sanitizeAttachmentBaseName(raw: string) {
  const cleaned = raw
    .trim()
    .replaceAll(/[^a-zA-Z0-9._-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^[-.]+|[-.]+$/g, "");
  return cleaned || "attachment";
}

function buildAttachmentFilename(params: {
  originalFilename?: string;
  defaultBaseName: string;
  contentType?: string;
}) {
  const originalFilename = params.originalFilename?.trim() ?? "";
  const originalExtension = extname(originalFilename);
  const baseName = sanitizeAttachmentBaseName(
    originalExtension
      ? originalFilename.slice(0, -originalExtension.length)
      : originalFilename || params.defaultBaseName,
  );
  const extension = originalExtension || extensionFromContentType(params.contentType);
  return `${baseName}${extension}`;
}

async function resolveUniquePath(directoryPath: string, fileName: string) {
  const extension = extname(fileName);
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;
  let candidatePath = join(directoryPath, fileName);
  let index = 2;

  while (true) {
    try {
      await access(candidatePath);
      candidatePath = join(directoryPath, `${baseName}-${index}${extension}`);
      index += 1;
    } catch {
      return candidatePath;
    }
  }
}

export async function saveWorkspaceAttachment(params: {
  workspacePath: string;
  sessionKey: string;
  messageId: string;
  buffer: Buffer;
  originalFilename?: string;
  contentType?: string;
  defaultBaseName: string;
}) {
  const attachmentDir = join(
    params.workspacePath,
    ".attachments",
    sanitizeSessionName(params.sessionKey),
    sanitizeSessionName(params.messageId),
  );
  await ensureDir(attachmentDir);

  const fileName = buildAttachmentFilename({
    originalFilename: params.originalFilename,
    defaultBaseName: params.defaultBaseName,
    contentType: params.contentType,
  });
  const filePath = await resolveUniquePath(attachmentDir, fileName);
  await Bun.write(filePath, params.buffer);
  return filePath;
}
