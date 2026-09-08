// Fusion-owned inbound media boundary, replacing the download half of
// `extensions/feishu/src/media.ts` (D-FS-005).
//
// Upstream's `media.ts` is 1097 lines over OpenClaw's media runtime: the media
// store (`plugin-sdk/media-store` → `src/media/store.ts`), the private temp
// workspace (`plugin-sdk/temp-path`), ffmpeg/ffprobe voice transcoding and the
// outbound upload path. Those are OpenClaw host services with no Fusion
// counterpart — the Hub owns media authorization and hands the vertical one
// per-account download directory. The whole file is omitted
// (upstream-sync.json `omitted`) and this module carries the one function the
// ported `bot-content.ts` imports, with upstream's name, parameters and return
// shape so `resolveFeishuMediaList` stays verbatim.
//
// The response-shape ladder (Buffer / ArrayBuffer / `getReadableStream` /
// `writeFile` / async iterator) is upstream's, because it is a property of the
// Lark SDK's download responses, not of OpenClaw. The size cap is enforced
// while reading, not after: an oversized resource must not be buffered whole.
//
// The outbound upload half is NOT carried in this slice: it lands with the Hub
// media slice (see HUB-WIRING.md §8).

import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extensionForMime } from "@getpaseo/channels-core/plugin-sdk/media-runtime";
import { normalizeFeishuExternalKey } from "../external-keys.js";
import { createFeishuClient } from "../client.js";
import { resolveFeishuRuntimeAccount } from "../accounts.js";
import type { ClawdbotConfig } from "./runtime-api.js";

/** Upstream `media.ts`'s `SavedMedia` slice that `bot-content.ts` reads. */
export interface FeishuSavedMedia {
  path: string;
  contentType?: string;
  fileName?: string;
}

/** Upstream `media.ts::SaveMessageResourceResult`, unchanged. */
export interface SaveMessageResourceResult {
  saved: FeishuSavedMedia;
  contentType?: string;
  fileName?: string;
}

/** Per-account download roots, filled by the L4 lifecycle from
 * `StartAccountContext.mediaDownloadDir`. Absent = the process temp dir. */
const downloadDirs = new Map<string, string>();

export function setFeishuMediaDownloadDir(accountId: string, dir: string | undefined): void {
  if (dir === undefined) downloadDirs.delete(accountId);
  else downloadDirs.set(accountId, dir);
}

export function resolveFeishuMediaDownloadDir(accountId?: string): string {
  return downloadDirs.get(accountId ?? "") ?? path.join(tmpdir(), "clisbot-feishu-media");
}

export class FeishuMediaTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Feishu media exceeds the configured limit of ${maxBytes} bytes`);
    this.name = "FeishuMediaTooLargeError";
  }
}

/** Upstream `media.ts::saveMessageResourceFeishu`: same parameters, same
 * `{ saved, contentType?, fileName? }` result, same "file" → "media" retry. */
export async function saveMessageResourceFeishu(params: {
  cfg: ClawdbotConfig;
  messageId: string;
  fileKey: string;
  type: "image" | "file";
  accountId?: string;
  maxBytes: number;
  originalFilename?: string;
}): Promise<SaveMessageResourceResult> {
  const normalizedFileKey = normalizeFeishuExternalKey(params.fileKey);
  if (!normalizedFileKey) {
    throw new Error("Feishu message resource download failed: invalid file_key");
  }
  const account = resolveFeishuRuntimeAccount({
    cfg: params.cfg,
    ...(params.accountId === undefined ? {} : { accountId: params.accountId }),
  });
  if (!account.configured) {
    throw new Error(`Feishu account "${account.accountId}" not configured`);
  }
  const client = createFeishuClient(account);
  try {
    return await downloadMessageResource({
      client,
      messageId: params.messageId,
      fileKey: normalizedFileKey,
      type: params.type,
      maxBytes: params.maxBytes,
      accountId: account.accountId,
      ...(params.originalFilename === undefined
        ? {}
        : { originalFilename: params.originalFilename }),
    });
  } catch (error) {
    if (params.type !== "file" || !isHttpStatusError(error, 502)) throw error;
    // Upstream's fallback: some file resources are only served as "media".
    try {
      return await downloadMessageResource({
        client,
        messageId: params.messageId,
        fileKey: normalizedFileKey,
        type: "media",
        maxBytes: params.maxBytes,
        accountId: account.accountId,
        ...(params.originalFilename === undefined
          ? {}
          : { originalFilename: params.originalFilename }),
      });
    } catch {
      throw error;
    }
  }
}

interface DownloadClient {
  im: {
    messageResource: {
      get(args: {
        path: { message_id: string; file_key: string };
        params: { type: string };
      }): Promise<unknown>;
    };
  };
}

async function downloadMessageResource(params: {
  client: DownloadClient;
  messageId: string;
  fileKey: string;
  type: "image" | "file" | "media";
  maxBytes: number;
  accountId: string;
  originalFilename?: string;
}): Promise<SaveMessageResourceResult> {
  const response = await params.client.im.messageResource.get({
    path: { message_id: params.messageId, file_key: params.fileKey },
    params: { type: params.type },
  });
  const meta = extractFeishuDownloadMetadata(response);
  const saved = await saveFeishuResponseMedia({
    response,
    maxBytes: params.maxBytes,
    dir: resolveFeishuMediaDownloadDir(params.accountId),
    baseName: params.fileKey,
    ...(meta.contentType === undefined ? {} : { contentType: meta.contentType }),
    fileName: meta.fileName ?? params.originalFilename,
  });
  return { saved, ...meta };
}

/** Upstream `media.ts::extractFeishuDownloadMetadata`, same header ladder. */
export function extractFeishuDownloadMetadata(response: unknown): {
  contentType?: string;
  fileName?: string;
} {
  const record = (response ?? {}) as Record<string, unknown>;
  const headers =
    asHeaderMap(record["headers"]) ?? asHeaderMap(record["header"]) ?? new Map<string, string>();
  const data = (record["data"] ?? {}) as Record<string, unknown>;
  const contentType =
    headers.get("content-type") ??
    asString(record["contentType"]) ??
    asString(record["mime_type"]) ??
    asString(data["contentType"]) ??
    asString(data["mime_type"]);
  const disposition = headers.get("content-disposition");
  const fileName =
    (disposition === undefined ? undefined : decodeDispositionFileName(disposition)) ??
    asString(record["file_name"]) ??
    asString(record["fileName"]) ??
    asString(data["file_name"]) ??
    asString(data["fileName"]);
  return {
    ...(contentType === undefined ? {} : { contentType: stripCharset(contentType) }),
    ...(fileName === undefined ? {} : { fileName }),
  };
}

async function saveFeishuResponseMedia(params: {
  response: unknown;
  maxBytes: number;
  dir: string;
  baseName: string;
  contentType?: string;
  fileName?: string;
}): Promise<FeishuSavedMedia> {
  const target = await reserveTargetPath(params);
  const record = (params.response ?? {}) as Record<string, unknown>;
  const code = record["code"];
  if (typeof code === "number" && code !== 0) {
    throw new Error(
      `Feishu message resource download failed: ${asString(record["msg"]) ?? `code ${code}`}`,
    );
  }
  const direct = asBinary(params.response) ?? asBinary(record["data"]);
  if (direct !== undefined) {
    if (direct.byteLength > params.maxBytes) throw new FeishuMediaTooLargeError(params.maxBytes);
    await pipeline(Readable.from(direct), createWriteStream(target));
    return built(target, params);
  }
  const stream = readableFrom(params.response, record);
  if (stream !== undefined) {
    await writeBounded(stream, target, params.maxBytes);
    return built(target, params);
  }
  const writeFile = record["writeFile"];
  if (typeof writeFile === "function") {
    await (writeFile as (p: string) => Promise<void>).call(params.response, target);
    const stats = await stat(target);
    if (stats.size > params.maxBytes) {
      await rm(target, { force: true });
      throw new FeishuMediaTooLargeError(params.maxBytes);
    }
    return built(target, params);
  }
  await rm(target, { force: true });
  throw new Error(
    `Feishu message resource download failed: unexpected response format. Keys: [${Object.keys(record).join(", ")}]`,
  );
}

function readableFrom(response: unknown, record: Record<string, unknown>): Readable | undefined {
  if (response instanceof Readable) return response;
  const getReadableStream = record["getReadableStream"];
  if (typeof getReadableStream === "function") {
    return Readable.from(
      (getReadableStream as () => AsyncIterable<Uint8Array>).call(response) as AsyncIterable<
        Uint8Array | string
      >,
    );
  }
  if (typeof (record as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function") {
    return Readable.from(response as AsyncIterable<Uint8Array | string>);
  }
  return undefined;
}

/** Enforces the cap while the bytes arrive; an oversized body is never buffered. */
async function writeBounded(source: Readable, target: string, maxBytes: number): Promise<void> {
  let written = 0;
  const sink = createWriteStream(target);
  try {
    await pipeline(source, async function* (chunks) {
      for await (const chunk of chunks) {
        const buffer = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
        written += buffer.byteLength;
        if (written > maxBytes) throw new FeishuMediaTooLargeError(maxBytes);
        yield buffer;
      }
    }, sink);
  } catch (error) {
    await rm(target, { force: true });
    throw error;
  }
}

async function reserveTargetPath(params: {
  dir: string;
  baseName: string;
  contentType?: string;
  fileName?: string;
}): Promise<string> {
  await mkdir(params.dir, { recursive: true });
  const named = params.fileName === undefined ? undefined : path.basename(params.fileName);
  const safe =
    named !== undefined && named !== "" && named !== "." && named !== ".."
      ? named
      : `${params.baseName.replace(/[^A-Za-z0-9._-]/g, "_")}${
          params.contentType === undefined ? "" : `.${extensionForMime(params.contentType)}`
        }`;
  return path.join(params.dir, `${Date.now()}-${safe}`);
}

function built(target: string, params: { contentType?: string; fileName?: string }): FeishuSavedMedia {
  return {
    path: target,
    ...(params.contentType === undefined ? {} : { contentType: params.contentType }),
    ...(params.fileName === undefined ? {} : { fileName: params.fileName }),
  };
}

function asBinary(value: unknown): Buffer | undefined {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function stripCharset(value: string): string {
  return value.split(";", 1)[0]?.trim() ?? value;
}

function asHeaderMap(value: unknown): Map<string, string> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const map = new Map<string, string>();
  const entries =
    typeof (value as { entries?: unknown }).entries === "function"
      ? Array.from((value as { entries(): Iterable<[string, unknown]> }).entries())
      : Object.entries(value as Record<string, unknown>);
  for (const [key, raw] of entries) {
    const text = Array.isArray(raw) ? raw[0] : raw;
    if (typeof text === "string") map.set(key.toLowerCase(), text);
  }
  return map.size > 0 ? map : undefined;
}

/** RFC 5987 `filename*` first, then a plain `filename`. */
export function decodeDispositionFileName(disposition: string): string | undefined {
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(disposition);
  if (extended?.[2] !== undefined) {
    try {
      return decodeURIComponent(extended[2].trim());
    } catch {
      return extended[2].trim();
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  return plain?.[1]?.trim();
}

function isHttpStatusError(error: unknown, status: number): boolean {
  if (error === null || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  if (record["status"] === status || record["statusCode"] === status) return true;
  const response = record["response"] as Record<string, unknown> | undefined;
  return response?.["status"] === status;
}
