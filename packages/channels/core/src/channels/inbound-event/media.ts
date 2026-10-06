// upstream: src/channels/inbound-event/media.ts@5d8067a4483
// D-CORE-501: upstream's `inbound-event/media.ts` normalizes channel attachment
// input into runtime media facts (probing files within a budget, resolving local
// media paths, rendering placeholder text). Fusion's Hub owns inbound media
// staging (goal slices 1-3), so this file carries the plugin-facing input shape
// the ported Telegram body helpers type against, verbatim from upstream. The
// WhatsApp port adds upstream's two text-only renderers verbatim
// (`formatMediaPlaceholderText`, `formatInboundMediaUnavailableText`): the
// ported quoted-message and enrichment readers render a `<media:…>` body for a
// message the Hub receives as text.
import { kindFromMime, mimeTypeFromFilePath } from "../../media-core/mime.js";
import type { InboundMediaFacts } from "../turn/types.js";

/** Attachment metadata accepted from channel plugins before core normalization. */
export type ChannelInboundMediaInput = {
  path?: string | null;
  url?: string | null;
  contentType?: string | null;
  fileName?: string | null;
  kind?: InboundMediaFacts["kind"] | null;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  transcribed?: boolean | null;
  messageId?: string | null;
};

export type MediaPlaceholderTextFact = Readonly<
  Pick<ChannelInboundMediaInput, "contentType" | "kind" | "path" | "url">
>;

type MediaPlaceholderKind =
  | Exclude<NonNullable<InboundMediaFacts["kind"]>, "unknown">
  | "attachment";

function resolveMediaPlaceholderKind(media: MediaPlaceholderTextFact): MediaPlaceholderKind {
  if (media.kind && media.kind !== "unknown") {
    return media.kind;
  }
  const inferredKind =
    kindFromMime(media.contentType) ??
    kindFromMime(mimeTypeFromFilePath(media.url)) ??
    kindFromMime(mimeTypeFromFilePath(media.path));
  return inferredKind && inferredKind !== "unknown" ? inferredKind : "attachment";
}

const PLURAL_MEDIA_PLACEHOLDER_LABELS: Readonly<Record<MediaPlaceholderKind, string>> = {
  image: "images",
  video: "videos",
  audio: "audio attachments",
  document: "files",
  sticker: "stickers",
  attachment: "attachments",
};

/** Renders structured media facts for channel surfaces that can carry text only. */
export function formatMediaPlaceholderText(media: readonly MediaPlaceholderTextFact[]): string {
  if (media.length === 0) {
    return "";
  }
  const kinds = media.map(resolveMediaPlaceholderKind);
  const firstKind = kinds[0] ?? "attachment";
  const kind = kinds.every((candidate) => candidate === firstKind)
    ? firstKind
    : kinds.includes("attachment")
      ? "attachment"
      : "document";
  const tag = `<media:${kind}>`;
  return media.length === 1
    ? tag
    : `${tag} (${media.length} ${PLURAL_MEDIA_PLACEHOLDER_LABELS[kind]})`;
}

/** Appends an unavailable-media notice to real caption text, or returns the notice alone. */
export function formatInboundMediaUnavailableText(params: {
  body?: string | null;
  notice: string;
}): string {
  const body = params.body?.trim() ?? "";
  const notice = params.notice.trim();
  if (!body) {
    return notice;
  }
  return `${body}\n\n${notice}`;
}
