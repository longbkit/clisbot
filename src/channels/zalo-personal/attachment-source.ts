import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { downloadRemoteBuffer } from "../../agents/attachments/download.ts";

export async function resolveZaloPersonalAttachmentSource(pathOrUrl: string, localData?: Buffer | Uint8Array) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    const downloaded = await downloadRemoteBuffer({ url: pathOrUrl });
    const filename = filenameFromUrl(pathOrUrl, downloaded.contentType);
    return {
      data: downloaded.buffer,
      filename: filename as `${string}.${string}`,
      metadata: { totalSize: downloaded.buffer.length },
    };
  }
  const data = localData ? Buffer.from(localData) : await readFile(pathOrUrl);
  const filename = basename(pathOrUrl);
  if (!filename.includes(".")) throw new Error("--file path must include an extension.");
  return {
    data,
    filename: filename as `${string}.${string}`,
    metadata: { totalSize: data.length },
  };
}

function filenameFromUrl(rawUrl: string, contentType?: string) {
  const pathname = new URL(rawUrl).pathname;
  const name = basename(pathname);
  if (name.includes(".")) return name;
  const extension = extensionFromContentType(contentType);
  if (!extension) throw new Error("--file URL path must include an extension or return a known content-type.");
  return `attachment.${extension}`;
}

function extensionFromContentType(contentType?: string) {
  const normalized = contentType?.split(";")[0]?.trim().toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  if (normalized === "video/mp4") return "mp4";
  if (normalized === "audio/wav" || normalized === "audio/x-wav") return "wav";
  if (normalized === "audio/mpeg") return "mp3";
  if (normalized === "application/pdf") return "pdf";
  if (normalized === "text/plain") return "txt";
  return undefined;
}
