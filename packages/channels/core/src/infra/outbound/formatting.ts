// upstream: src/infra/outbound/formatting.ts@5d8067a4483
// Formatting options carried through outbound planning control text chunking,
// table rendering, markdown handling, and parse mode.
// D-CORE-208: `ChunkMode` comes from `src/auto-reply/chunk.ts`, which pulls the
// OpenClaw reply pipeline (token accounting, per-agent config). The union is the
// same one upstream declares there.
import type { MarkdownTableMode, TextChunkMode as ChunkMode } from "../../config/types.js";

/**
 * Formatting and chunking hints carried through outbound delivery planning.
 */
export type OutboundDeliveryFormattingOptions = {
  textLimit?: number;
  maxLinesPerMessage?: number;
  tableMode?: MarkdownTableMode;
  chunkMode?: ChunkMode;
  parseMode?: "HTML";
};
