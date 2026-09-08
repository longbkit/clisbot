// upstream: src/plugin-sdk/text-chunking.ts@5d8067a4483
// Text chunking helpers split long outbound text while preserving readable line boundaries.
import { chunkTextByBreakResolver, splitLongTextLine } from "../shared/text-chunking.js";

/** Offset-preserving text ranges for transports with native style metadata. */
export {
  avoidTrailingHighSurrogateBreak,
  chunkTextRanges,
  type ChunkTextRangesOptions,
  type TextChunkRange,
} from "@getpaseo/channels-markdown-core/chunk-text";
/** Quote-aware HTML tag tokens for exact post-render projections. */
export { tokenizeHtmlTags } from "@getpaseo/channels-markdown-core/html-tags";
/** Static outbound formatting capabilities declared by a channel plugin. */
export { FormatCapabilityProfile } from "@getpaseo/channels-markdown-core/format-capabilities";

/**
 * Splits outbound channel text into chunks no longer than the requested limit.
 * Newline boundaries win over spaces; text without usable separators falls back
 * to a hard character split so channel senders always receive bounded strings.
 */
export function chunkTextForOutbound(
  text: string,
  limit: number,
  options?: { preserveWhitespace?: boolean; formatting?: unknown },
): string[] {
  if (options?.preserveWhitespace !== undefined) {
    return splitLongTextLine(text, limit, { preserveWhitespace: options.preserveWhitespace });
  }
  return chunkTextByBreakResolver(text, limit, (window) => {
    const lastNewline = window.lastIndexOf("\n");
    const lastSpace = window.lastIndexOf(" ");
    return lastNewline > 0 ? lastNewline : lastSpace;
  });
}

/** Markdown IR parsing and slicing primitives for plugin-owned renderers. */
export {
  chunkMarkdownIR,
  markdownToIR,
  markdownToIRWithMeta,
  sliceMarkdownIR,
  type MarkdownIR,
  type MarkdownLinkSpan,
  type MarkdownParseOptions,
  type MarkdownStyle,
  type MarkdownStyleSpan,
  type MarkdownTableCell,
  type MarkdownTableMeta,
} from "@getpaseo/channels-markdown-core/ir";
/** Render-size-aware Markdown chunking for channel payload limits. */
export {
  renderMarkdownIRChunksWithinLimit,
  type RenderMarkdownIRChunksWithinLimitOptions,
} from "@getpaseo/channels-markdown-core/render-aware-chunking";
/** Attributed Markdown rendering hooks for native channel formatting. */
export {
  renderMarkdownWithAttributedRanges,
  type AttributedRenderOptions,
} from "@getpaseo/channels-markdown-core/render-attributed";
/** Marker-based Markdown rendering hooks for channel-specific formatting. */
export {
  renderMarkdownWithMarkers,
  type RenderLink,
  type RenderOptions,
  type RenderStyleMap,
  type RenderStyleMarker,
} from "@getpaseo/channels-markdown-core/render";
/** Markdown table conversion helper shared by text-only channel renderers. */
export { convertMarkdownTables } from "@getpaseo/channels-markdown-core/tables";
/** File-reference detection helpers for avoiding accidental autolinks. */
export {
  FILE_REF_EXTENSIONS_WITH_TLD,
  isAutoLinkedFileRef,
} from "../shared/text/auto-linked-file-ref.js";
// D-CORE-001: the upstream barrel also re-exports assistant-visible-text,
// code-regions, reasoning-tags, strip-markdown, terminal safe-text,
// system-message, directive-tags and chunk-items. Those are not part of the
// formatting/chunking closure ported in slice 5; see upstream-sync.json.

// Slice 13 addition (Discord vertical port): the ported Discord chunker keeps
// fenced code regions intact.
export { findCodeRegions } from "../shared/text/code-regions.js";

// Slice 14 addition (Google Chat vertical port): the canonical assistant-visible
// text sanitizer the ported Google Chat formatter runs before markdown parsing.
// Same upstream barrel, same source module (`src/shared/text/assistant-visible-text.ts`).
export {
  sanitizeAssistantVisibleText,
  sanitizeAssistantVisibleTextWithProfile,
  stripAssistantInternalScaffolding,
} from "../shared/text/assistant-visible-text.js";

