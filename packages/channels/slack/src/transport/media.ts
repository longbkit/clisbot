// COMPAT(clisbot-control-plane): Slack inbound media (F-06, G5+G6) — the
// mirror of the Telegram vertical's inbound-media fold: extract the
// `files[]` a message event carries, download each (Slack Web API URL,
// Bearer bot token) into the account's download dir, and fold the
// `[Attached files]` manifest (shared, `buildAttachedFilesManifest`) into the
// inbound event body. A per-file failure or an external/unknown file is a
// logged skip, not a fault; every file failing (and no text) trims the body
// to `""` so the shared L3 processor drops the event — the same admission
// semantics the Telegram half gets from the empty-body drop.
//
// Sync reference: OpenClaw `extensions/slack/src/monitor/media.ts`
// (files[].url_private_download → url_private, Bearer token download, Slack
// host allowlist) — trimmed to the P0 fold (no audio preflight, no
// fresh-URL refetch, no concurrency pool: one download per file, in order).

import { formatErrorMessage } from "@getpaseo/channels-core/plugin-sdk/error-runtime";
import type { HostChildLogger, InboundAttachedFile } from "@getpaseo/channels-shared";
import {
  buildAttachedFilesManifest,
  downloadMediaFile,
  foldAttachedFilesIntoBody,
  mediaInboundMaxBytesForChannel,
  MEDIA_DOWNLOAD_TIMEOUT_MS,
  type ChannelInboundEvent,
} from "@getpaseo/channels-shared";
import type { SlackMessageEvent } from "./socket-event-filter.js";

/** The carrier kinds the manifest reports (classified from the file's
 * `mimetype`, like the Telegram half's carrier kinds). */
export type SlackFileKind = "image" | "audio" | "video" | "document";

/** One downloadable file extracted from a message event's `files[]`. */
export interface SlackFileAttachment {
  kind: SlackFileKind;
  /** The native file name (`files[].name`), when the event carries one. */
  fileName?: string;
  /** The declared size in bytes (a safe integer when known). */
  size?: number;
  /** The download URL (`url_private_download` ?? `url_private`). */
  url: string;
}

/** A `files[]` entry the extractor refuses to download, with the reason the
 * fold logs. */
export interface SlackFileSkip {
  fileName: string;
  reason: "external" | "no-download-url" | "non-https" | "host-not-slack";
}

/** The extraction result: the downloadable files + the logged skips. */
export interface SlackFilesExtraction {
  attachments: SlackFileAttachment[];
  skipped: SlackFileSkip[];
}

/** The raw `files[]` entry the extractor reads (structural subset of
 * @slack/types' `File` — the vertical never imports OpenClaw types). */
interface SlackFileEntry {
  id?: string;
  name?: string;
  mimetype?: string;
  size?: number;
  url_private?: string;
  url_private_download?: string;
  external_url?: string;
  external_type?: string;
}

/** The download context for one account's inbound media. */
export interface SlackMediaDownloadContext {
  accountId: string;
  botToken: string;
  /** The account's download dir (`<dataDir>/channels/<accountId>/downloads`). */
  downloadDir: string;
  abortSignal: AbortSignal;
  fetchImpl?: typeof globalThis.fetch;
  logger?: HostChildLogger;
}

/** Default extension per kind when the native name carries none (the
 * Telegram half's per-kind defaults, same vocabulary). */
const DEFAULT_EXT: Record<SlackFileKind, string> = {
  image: ".jpg",
  document: ".bin",
  audio: ".mp3",
  video: ".mp4",
};

/** The Slack file-URL host allowlist (OpenClaw `assertSlackFileUrl`): a file
 * URL that does not sit on a Slack host is refused — the bot token must never
 * ride to a non-Slack host. */
const SLACK_FILE_HOST_SUFFIXES = ["slack.com", "slack-edge.com", "slack-files.com"];

/** Classify a file's carrier kind from its `mimetype` (unknown/absent →
 * document — the manifest's catch-all kind). */
function kindFromMime(mimetype: string | undefined): SlackFileKind {
  const mime = mimetype?.trim().toLowerCase();
  if (mime === undefined || mime === "") return "document";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

/** A safe path segment out of a native file name (same sanitization the
 * Telegram half applies to `file_name`). */
function sanitizeBase(name: string | undefined): string {
  if (name === undefined || name === "") return "file";
  const segment = name.replace(/[\\/:*?"<>|]/g, "-");
  return segment !== "" ? segment : "file";
}

/** True when the base name already carries an extension. */
function baseHasExt(base: string): boolean {
  return base.lastIndexOf(".") > 0;
}

/** The download URL of one file entry, or undefined when the entry is
 * external (an `external_url` link file) or carries no download URL. */
function downloadUrlOf(entry: SlackFileEntry): string | undefined {
  if (
    (typeof entry.external_url === "string" && entry.external_url !== "") ||
    (typeof entry.external_type === "string" && entry.external_type !== "")
  ) {
    return undefined;
  }
  const url =
    (typeof entry.url_private_download === "string" && entry.url_private_download !== ""
      ? entry.url_private_download
      : undefined) ??
    (typeof entry.url_private === "string" && entry.url_private !== ""
      ? entry.url_private
      : undefined);
  return url ?? undefined;
}

/** The host allowlist check (OpenClaw `assertSlackFileUrl`): https + a Slack
 * host; a refusal is a skip, not a fault (the rest of the message is intact). */
function isSlackFileUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return SLACK_FILE_HOST_SUFFIXES.some(
    (suffix) => parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`),
  );
}

/** Extract the message event's downloadable `files[]` + the skipped entries
 * (external link files, entries with no download URL, non-Slack/https URLs).
 * No `files` / non-array / empty → no attachments, no skips. */
export function extractSlackFileAttachments(event: SlackMessageEvent): SlackFilesExtraction {
  const rawFiles = event["files"];
  if (!Array.isArray(rawFiles)) return { attachments: [], skipped: [] };
  const attachments: SlackFileAttachment[] = [];
  const skipped: SlackFileSkip[] = [];
  for (const entry of rawFiles as Array<SlackFileEntry | null>) {
    if (entry === null || typeof entry !== "object") continue;
    const fileName = sanitizeBase(typeof entry.name === "string" ? entry.name : undefined);
    const url = downloadUrlOf(entry);
    if (url === undefined) {
      skipped.push({ fileName, reason: "external" });
      continue;
    }
    if (!isSlackFileUrl(url)) {
      skipped.push({ fileName, reason: "host-not-slack" });
      continue;
    }
    const size =
      typeof entry.size === "number" && Number.isSafeInteger(entry.size) ? entry.size : undefined;
    attachments.push({
      kind: kindFromMime(entry.mimetype),
      ...(typeof entry.name === "string" && entry.name !== "" ? { fileName: entry.name } : {}),
      ...(size !== undefined ? { size } : {}),
      url,
    });
  }
  return { attachments, skipped };
}

/** Download one attachment to `downloadDir` (Bearer bot token, the shared
 * stream-to-disk helper, the 10-min floor); returns the saved record. */
export async function downloadSlackFile(
  ctx: SlackMediaDownloadContext,
  attachment: SlackFileAttachment,
  messageId: string,
  index: number,
): Promise<InboundAttachedFile> {
  const base = sanitizeBase(attachment.fileName);
  const fileName = `${messageId}-${index + 1}-${base}${
    baseHasExt(base) ? "" : DEFAULT_EXT[attachment.kind]
  }`;
  const signal = AbortSignal.any([ctx.abortSignal, AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS)]);
  const { bytes, path } = await downloadMediaFile({
    url: attachment.url,
    dir: ctx.downloadDir,
    fileName,
    // The uploader picks the size; without a ceiling one message fills the disk.
    maxBytes: mediaInboundMaxBytesForChannel("slack"),
    headers: { Authorization: `Bearer ${ctx.botToken}` },
    ...(ctx.fetchImpl !== undefined ? { fetchImpl: ctx.fetchImpl } : {}),
    signal,
  });
  return { name: base, kind: attachment.kind, bytes, path };
}

/** Fold the message's files into the event: skip-logs first, download each
 * attachment in order, build the shared manifest, fold it into `event.body`.
 * Per-file failure is a logged skip; when no file survives AND the body is
 * empty the event is dropped (returns null — the shared L3's empty-body drop
 * would catch it too, this keeps the transport's decision local). No files
 * → event unchanged. */
export async function foldInboundSlackMedia(
  ctx: SlackMediaDownloadContext,
  event: SlackMessageEvent,
  inbound: ChannelInboundEvent,
): Promise<ChannelInboundEvent | null> {
  const extraction = extractSlackFileAttachments(event);
  if (extraction.attachments.length === 0 && extraction.skipped.length === 0) {
    return inbound;
  }
  for (const skip of extraction.skipped) {
    ctx.logger?.warn?.("slack inbound media skipped file", {
      accountId: ctx.accountId,
      fileName: skip.fileName,
      reason: skip.reason,
    });
  }
  const saved: InboundAttachedFile[] = [];
  for (let i = 0; i < extraction.attachments.length; i++) {
    const attachment = extraction.attachments[i]!;
    try {
      saved.push(await downloadSlackFile(ctx, attachment, inbound.externalMessageId, i));
    } catch (error) {
      ctx.logger?.error?.("slack inbound media download failed (skipping file)", {
        accountId: ctx.accountId,
        fileName: attachment.fileName,
        error: formatErrorMessage(error),
      });
    }
  }
  const manifest = buildAttachedFilesManifest(saved);
  const folded = foldAttachedFilesIntoBody(inbound.body, manifest);
  if (folded.trim() === "") return null;
  return { ...inbound, body: folded };
}
