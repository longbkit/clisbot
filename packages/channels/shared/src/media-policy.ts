// COMPAT(clisbot-control-plane): shared OUTBOUND-media policy (group G, G7–G11)
// — the one home for the G11 size caps + the in-channel "could not post media"
// notice wording + the mime/extension table the verticals route uploads by.
// Inbound media (download + manifest) lives in
// `media.js`; this module is the outbound half, kept separate so each concern
// has one file.
//
// Both verticals' `sendMedia` call `evaluateOutboundMedia` ONCE before the
// native post: the G11 gate is SIZE ONLY — both channels can post arbitrary
// files (Slack's `completeUploadExternal` takes any type; Telegram's
// `sendDocument` takes any type up to 50 MB), so an unknown/unmapped
// extension is NOT a reject — the vertical posts it (Telegram routes to
// `sendDocument`, Slack to the generic external upload). An oversized file is
// NOT silently dropped: the vertical posts the returned `notice` through its
// text path and reports `mediaPosted: false`. Transport faults (a missing
// file, a Bot API / Web API failure) still throw; the Hub's failDelivery owns
// those.

import { basename } from "node:path";

/** The G11 per-channel upload caps (bytes). */
export const TELEGRAM_MAX_MEDIA_BYTES = 50 * 1024 * 1024;
export const SLACK_MAX_MEDIA_BYTES = 250 * 1024 * 1024;

/** The channel the G11 policy is applied under. */
export type MediaChannel = "telegram" | "slack";

/** Why an outbound file may not be posted natively: the G11 gate is size-only
 * (an unknown/unmapped extension posts as `application/octet-stream`). */
export type MediaRejectReason = "too-large";

/** The channel's display name, used only inside the in-channel notice. */
const CHANNEL_LABEL: Record<MediaChannel, string> = {
  telegram: "Telegram",
  slack: "Slack",
};

/** The channel's G11 cap in bytes. */
export function mediaMaxBytesForChannel(channel: MediaChannel): number {
  return channel === "telegram" ? TELEGRAM_MAX_MEDIA_BYTES : SLACK_MAX_MEDIA_BYTES;
}

/** The in-channel notice for a file the channel will not post natively.
 * Wording is pinned by G11: "Could not post media <name>: too large
 * (Telegram limit 50 MB)" / "…(Slack limit 250 MB)". */
export function mediaNotice(channel: MediaChannel, fileName: string): string {
  const limitMb = Math.round(mediaMaxBytesForChannel(channel) / 1024 / 1024);
  return `Could not post media ${fileName}: too large (${CHANNEL_LABEL[channel]} limit ${limitMb} MB)`;
}

/** A modest ext→mime table for the supported media types (OpenClaw
 * `media-core`'s `EXT_BY_MIME`, trimmed to the outbound surface). */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".m4a": "audio/m4a",
  ".opus": "audio/opus",
  ".amr": "audio/amr",
  ".pdf": "application/pdf",
};

/** The mime for a file extension, or undefined when the extension is unknown
 * (the caller posts the file anyway — Telegram routes it to `sendDocument`,
 * Slack to the generic external upload — treating it as
 * `application/octet-stream`). */
export function mimeFromExtension(extension: string): string | undefined {
  return MIME_BY_EXT[extension.toLowerCase()];
}

/** The G11 gate for one outbound file. `sizeBytes` comes from a `stat` the
 * vertical performs. The gate is SIZE ONLY: both channels post arbitrary
 * files, so the mime (image/video/audio/pdf or not) never rejects. Pure —
 * no I/O. */
export type MediaPolicyDecision =
  | { ok: true }
  | { ok: false; reason: MediaRejectReason; notice: string };

export function evaluateOutboundMedia(params: {
  sizeBytes: number;
  mime?: string;
  channel: MediaChannel;
  fileName: string;
}): MediaPolicyDecision {
  if (params.sizeBytes > mediaMaxBytesForChannel(params.channel)) {
    return {
      ok: false,
      reason: "too-large",
      notice: mediaNotice(params.channel, params.fileName),
    };
  }
  return { ok: true };
}

/** The base name of a path (the file name the notice + upload title use). */
export function mediaFileName(filePath: string): string {
  return basename(filePath);
}
