// upstream: src/channels/inbound-event/media.ts@5d8067a4483
// D-CORE-501: upstream's `inbound-event/media.ts` normalizes channel attachment
// input into runtime media facts (probing files within a budget, resolving local
// media paths, rendering placeholder text). Fusion's Hub owns inbound media
// staging (goal slices 1-3), so this file carries the plugin-facing input shape
// the ported Telegram body helpers type against, verbatim from upstream.
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
