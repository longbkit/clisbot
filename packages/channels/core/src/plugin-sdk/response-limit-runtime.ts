// upstream: src/plugin-sdk/response-limit-runtime.ts@5d8067a4483
// Narrow response-size reader for plugins that download bounded HTTP bodies.

export { readByteStreamWithLimit } from "../media-core/read-byte-stream-with-limit.js";
export { readResponseTextPrefix, readResponseWithLimit } from "../infra/http-response-body.js";
export type {
  ReadResponseTextPrefixOptions,
  ReadResponseTextPrefixResult,
} from "../infra/http-response-body.js";
