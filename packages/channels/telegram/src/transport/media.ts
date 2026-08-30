// COMPAT(clisbot-control-plane): Telegram inbound media (group G, G1–G6) —
// extract the carriers a Bot API message carries, download each through the
// Bot API `getFile` + file stream into the account's download dir, and fold
// the `[Attached files]` manifest into the inbound event body. Stickers are
// out of scope. A per-attachment failure is a skip (logged), not a fault:
// admission of the message is unaffected.

import type { HostChildLogger, InboundAttachedFile } from "@getpaseo/channels-shared";
import {
  buildAttachedFilesManifest,
  downloadMediaFile,
  foldAttachedFilesIntoBody,
  MEDIA_DOWNLOAD_TIMEOUT_MS,
  type ChannelInboundEvent,
} from "@getpaseo/channels-shared";
import type { TelegramMessageShape } from "./poll.js";

/** The media carriers the extractor handles (sticker is out of scope). */
export type TelegramAttachmentKind =
  | "photo"
  | "document"
  | "audio"
  | "voice"
  | "video"
  | "animation";

/** One attachment extracted from a Telegram message. */
export interface TelegramAttachment {
  kind: TelegramAttachmentKind;
  fileId: string;
  /** The document's native file name (document carrier only). */
  fileName?: string;
  /** The carrier's declared size in bytes (a safe integer when known). */
  size?: number;
}

/** The download context for one account's inbound media. */
export interface TelegramMediaDownloadContext {
  accountId: string;
  botToken: string;
  apiRoot: string;
  /** The account's download dir (`<dataDir>/channels/<accountId>/downloads`). */
  downloadDir: string;
  abortSignal: AbortSignal;
  fetchImpl?: typeof globalThis.fetch;
  logger?: HostChildLogger;
}

/** Default extension per kind when the base name carries none. */
const DEFAULT_EXT: Record<TelegramAttachmentKind, string> = {
  photo: ".jpg",
  document: ".bin",
  audio: ".mp3",
  voice: ".ogg",
  video: ".mp4",
  animation: ".gif",
};

/** The Bot API file-download error type. The token is never embedded in the
 * message (the request URL carries it, but we only surface `fileId` + status). */
export class TelegramMediaDownloadError extends Error {
  readonly fileId: string;
  constructor(fileId: string, cause: string) {
    super(`telegram media download failed for file ${fileId}: ${cause}`);
    this.name = "TelegramMediaDownloadError";
    this.fileId = fileId;
  }
}

/** Sanitize a document file_name down to a safe path segment. */
function sanitizeBase(name: string | undefined, kind: TelegramAttachmentKind): string {
  if (name === undefined || name === "") return kind;
  const segment = name.replace(/[\\/:*?"<>|]/g, "-");
  return segment !== "" ? segment : kind;
}

/** True when the base name already carries an extension (so the saved name
 * keeps it as-is; otherwise a per-kind default extension is appended). */
function baseHasExt(base: string): boolean {
  const dot = base.lastIndexOf(".");
  return dot > 0;
}

/** Select the LARGEST photo element (by `file_size`; first wins ties) that
 * carries a non-empty `file_id`. */
function pickPhoto(
  photo: Array<{ file_id?: string; file_unique_id?: string; file_size?: number }> | undefined,
): { fileId: string; size?: number } | null {
  if (photo === undefined || photo.length === 0) return null;
  let best: { fileId: string; size?: number } | null = null;
  let bestSize = -1;
  for (const entry of photo) {
    if (typeof entry.file_id !== "string" || entry.file_id === "") continue;
    const size =
      typeof entry.file_size === "number" && Number.isSafeInteger(entry.file_size)
        ? entry.file_size
        : 0;
    if (size > bestSize || best === null) {
      best = { fileId: entry.file_id, ...(size > 0 ? { size } : {}) };
      bestSize = size;
    }
  }
  return best;
}

function carrierRecord(
  kind: TelegramAttachmentKind,
  carrier:
    | { file_id?: string; file_unique_id?: string; file_size?: number; file_name?: string }
    | undefined,
): TelegramAttachment | null {
  if (carrier === undefined) return null;
  const fileId = carrier.file_id;
  if (typeof fileId !== "string" || fileId === "") return null;
  const record: TelegramAttachment = { kind, fileId };
  if (kind === "document" && typeof carrier.file_name === "string" && carrier.file_name !== "") {
    record.fileName = carrier.file_name;
  }
  const size = carrier.file_size;
  if (typeof size === "number" && Number.isSafeInteger(size)) {
    record.size = size;
  }
  return record;
}

/** Extract the attachments a message carries, in a fixed deterministic order:
 * photo (largest element), then document, audio, voice, video, animation.
 * A Telegram message carries at most one carrier, so a multi-record result is
 * the multi-attachment case (G5) — but the order is stable regardless. */
export function extractTelegramAttachments(message: TelegramMessageShape): TelegramAttachment[] {
  const attachments: TelegramAttachment[] = [];
  const photo = pickPhoto(message.photo);
  if (photo !== null) attachments.push({ kind: "photo", ...photo });
  for (const [kind, carrier] of [
    ["document", message.document],
    ["audio", message.audio],
    ["voice", message.voice],
    ["video", message.video],
    ["animation", message.animation],
  ] as Array<[TelegramAttachmentKind, typeof message.document]>) {
    const record = carrierRecord(kind, carrier);
    if (record !== null) attachments.push(record);
  }
  return attachments;
}

/** One Bot API `getFile` call → the `file_path` the file stream is read from. */
async function resolveFilePath(ctx: TelegramMediaDownloadContext, fileId: string): Promise<string> {
  const fetchFn = ctx.fetchImpl ?? globalThis.fetch;
  // The URL embeds the token; never surface it in an error.
  const url = `${ctx.apiRoot}/bot${encodeURIComponent(ctx.botToken)}/getFile?file_id=${encodeURIComponent(fileId)}`;
  // A hung getFile must not stall the poll batch: same abort/timeout floor as the stream fetch.
  const signal = AbortSignal.any([ctx.abortSignal, AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS)]);
  const response = await fetchFn(url, { method: "GET", signal });
  if (!response.ok) {
    throw new TelegramMediaDownloadError(fileId, `getFile HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    ok: boolean;
    result?: { file_path?: string };
    description?: string;
  };
  if (
    body.ok !== true ||
    typeof body.result?.file_path !== "string" ||
    body.result.file_path === ""
  ) {
    throw new TelegramMediaDownloadError(fileId, body.description ?? "no file_path");
  }
  return body.result.file_path;
}

/** Download one attachment to `downloadDir`; returns the saved record. */
export async function downloadTelegramAttachment(
  ctx: TelegramMediaDownloadContext,
  attachment: TelegramAttachment,
  messageId: number,
  index: number,
): Promise<InboundAttachedFile> {
  const filePath = await resolveFilePath(ctx, attachment.fileId);
  const base = sanitizeBase(attachment.fileName, attachment.kind);
  const fileName = `${messageId}-${index + 1}-${base}${baseHasExt(base) ? "" : DEFAULT_EXT[attachment.kind]}`;
  const streamUrl = `${ctx.apiRoot}/file/bot${encodeURIComponent(ctx.botToken)}/${filePath}`;
  const signal = AbortSignal.any([ctx.abortSignal, AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS)]);
  const { bytes, path } = await downloadMediaFile({
    url: streamUrl,
    dir: ctx.downloadDir,
    fileName,
    ...(ctx.fetchImpl !== undefined ? { fetchImpl: ctx.fetchImpl } : {}),
    signal,
  });
  return { name: base, kind: attachment.kind, bytes, path };
}

/** Fold the message's media into the event: download each attachment,
 * build the manifest, fold it into `event.body`. Per-attachment failure is a
 * logged skip (G11-safe floor); if every attachment fails the body trims to
 * `""` and the event is dropped (returns null). No attachments → event
 * unchanged. */
export async function foldInboundTelegramMedia(
  ctx: TelegramMediaDownloadContext,
  message: TelegramMessageShape,
  event: ChannelInboundEvent,
): Promise<ChannelInboundEvent | null> {
  const attachments = extractTelegramAttachments(message);
  if (attachments.length === 0) return event;
  const saved: InboundAttachedFile[] = [];
  for (let i = 0; i < attachments.length; i++) {
    const attachment = attachments[i]!;
    try {
      const record = await downloadTelegramAttachment(ctx, attachment, message.message_id, i);
      saved.push(record);
    } catch (error) {
      ctx.logger?.error?.("telegram inbound media download failed (skipping attachment)", {
        accountId: ctx.accountId,
        messageId: message.message_id,
        kind: attachment.kind,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const manifest = buildAttachedFilesManifest(saved);
  const folded = foldAttachedFilesIntoBody(event.body, manifest);
  if (folded.trim() === "") return null;
  return { ...event, body: folded };
}
