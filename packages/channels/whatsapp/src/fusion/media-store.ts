// Fusion-owned `plugin-sdk/media-store` for `inbound/media.ts` (D-WA-021).
//
// Upstream saves downloaded inbound media into OpenClaw's media store. In Fusion
// the Hub names the directory an account downloads into
// (`StartAccountContext.mediaDownloadDir`); the inbound adapter lists the saved
// path in the `[Attached files]` manifest the Agent reads. The directory is
// scoped to the receive call (`withWhatsAppMediaDownloadDir`), because one Hub
// process runs several accounts and `saveMediaStream` carries no account. The
// size cap is upstream's argument, enforced while streaming so an oversized file
// never lands whole.
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { extensionForMime } from "@clisbot/channels-core/plugin-sdk/media-runtime";

export type SavedMedia = { id: string; path: string; size: number; contentType?: string };

const downloadDirScope = new AsyncLocalStorage<string | undefined>();

/** Runs `task` with inbound media landing in `dir` (the account's download dir). */
export function withWhatsAppMediaDownloadDir<T>(dir: string | undefined, task: () => T): T {
  return downloadDirScope.run(dir, task);
}

function safeFileName(originalFilename: string | undefined, contentType: string | undefined): string {
  const base = path.basename(originalFilename ?? "").replace(/[^\w.-]+/g, "_").slice(-80);
  const ext = path.extname(base) || extensionForMime(contentType) || "";
  const stem = base ? path.basename(base, path.extname(base)) : "media";
  return `${crypto.randomUUID()}-${stem}${ext}`;
}

export async function saveMediaStream(
  stream: AsyncIterable<unknown>,
  contentType?: string,
  subdir = "inbound",
  maxBytes = 50 * 1024 * 1024,
  originalFilename?: string,
): Promise<SavedMedia> {
  const downloadDir = downloadDirScope.getStore();
  if (downloadDir === undefined) {
    throw new Error("WhatsApp inbound media has no download directory (the Hub did not provide one)");
  }
  const dir = path.join(downloadDir, subdir);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const fileName = safeFileName(originalFilename, contentType);
  const filePath = path.join(dir, fileName);
  let size = 0;
  async function* capped() {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += buffer.length;
      if (size > maxBytes) {
        throw new Error(`WhatsApp media exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit`);
      }
      yield buffer;
    }
  }
  try {
    await pipeline(capped(), fs.createWriteStream(filePath, { mode: 0o600 }));
  } catch (error) {
    await fs.promises.rm(filePath, { force: true });
    throw error;
  }
  return { id: fileName, path: filePath, size, ...(contentType ? { contentType } : {}) };
}

/** A saved file's size for the attachment manifest; 0 when it cannot be read. */
export function fileSizeOrZero(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}
