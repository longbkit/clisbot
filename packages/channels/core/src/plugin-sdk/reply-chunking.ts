// upstream: src/plugin-sdk/reply-chunking.ts@5d8067a4483
// Outbound text chunking policy for channel senders.
export {
  chunkMarkdownTextWithMode,
  resolveTextChunkLimit,
  type ChunkMode,
} from "../auto-reply/chunk.js";

// Slice 10b addition (Slack send port): the chunk-mode resolver from the same
// upstream source module.
export { resolveChunkMode } from "../auto-reply/chunk.js";

// Slice 13 addition (Discord vertical port): the ported Discord chunker falls
// back to paragraph chunking for long messages.
export { chunkByParagraph } from "../auto-reply/chunk.js";
