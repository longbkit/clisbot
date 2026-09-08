// upstream: src/plugin-sdk/media-runtime.ts@5d8067a4483
// Media loading, probing and poll normalization for plugin runtimes.
export { isVoiceMessageCompatibleAudio } from "../media/audio.js";
export {
  buildOutboundMediaLoadOptions,
  type OutboundMediaAccess,
  type OutboundMediaReadFile,
} from "../media/load-options.js";
export { getImageMetadata, probeVideoDimensions } from "../media/media-services.js";
export { isGifMedia, kindFromMime } from "../media-core/mime.js";
export { normalizePollInput, type PollInput } from "../polls.js";
// D-CORE-226: the upstream barrel also re-exports the media store, temp files,
// ffmpeg limits, QR/PNG encoders, the agent media payload builders and the
// media-understanding model defaults. Those belong to the OpenClaw agent
// runtime; the Hub owns media authorization in Fusion.

// Slice 13 additions (Discord vertical port): the ported Discord sender names an
// uploaded attachment from its mime type and normalizes poll durations. Both
// come from the same source modules the upstream barrel names.
export { extensionForMime } from "../media-core/mime.js";
export { normalizePollDurationHours } from "../polls.js";

// Slice 14 additions (Google Chat vertical port). Upstream's barrel names the
// same three members; the sources are `packages/media-core/src/content-length.ts`
// (carried), `src/infra/http-response-body.ts` (carried) and `src/media/fetch.ts`.
// D-CORE-325: only `MediaFetchError` is taken from `src/media/fetch.ts` — the
// rest of that 770-line module is OpenClaw's guarded media downloader over the
// pinned-dispatcher SSRF stack, which the Hub replaces.
export { parseMediaContentLength } from "../media-core/content-length.js";
export { readResponseTextSnippet } from "../infra/http-response-body.js";
export { MediaFetchError, type MediaFetchErrorCode } from "../media/fetch-error.js";


// Slice 15 additions (Feishu vertical port): the ported doc upload input decodes
// and budgets base64 payloads, and the Feishu message types name the media kind
// union. Same upstream barrel, same source modules
// (`packages/media-core/src/base64.ts`, `.../constants.ts`).
export { canonicalizeBase64, estimateBase64DecodedBytes } from "../media-core/base64.js";
export type { MediaKind } from "../media-core/constants.js";
