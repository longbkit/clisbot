// Fusion-owned host adapter for `src/media/web-media.ts` (D-CORE-056).
//
// Upstream downloads a remote media URL through OpenClaw's fetch guard (SSRF
// policy, redirect limits, content-length caps, image optimization) into its
// media store. Fusion has no media store and its channel transports own their own
// fetch stack, so remote media is refused here instead of being fetched by an
// unguarded path. The result shape is upstream's so callers keep their types.
//
// D-CORE-237 (slice 9): a local file path is not a download. The Hub authorizes
// an outbound file before it reaches a vertical and passes an absolute path, so
// local reads delegate to the ported `./web-media.js` (which enforces the
// caller's `localRoots` / `readFile` boundary). Only remote URLs are refused.
import type { MediaKind } from "../media-core/constants.js";
import { loadWebMedia as loadLocalWebMedia, type WebMediaOptions } from "./web-media.js";

export type WebMediaResult = {
  buffer: Buffer;
  contentType?: string;
  kind: MediaKind | undefined;
  fileName?: string;
  /** Source bytes came from a generated-HTML trust boundary. */
  trustedGeneratedHtmlSource?: boolean;
};

const unavailable = (): never => {
  throw new Error(
    "Remote media download is not available in Fusion; pass a local file path or a buffer.",
  );
};

function isRemote(mediaUrl: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(mediaUrl) && !/^file:\/\//i.test(mediaUrl);
}

export async function loadWebMedia(
  mediaUrl: string,
  maxBytesOrOptions?: unknown,
  options?: unknown,
): Promise<WebMediaResult> {
  if (isRemote(mediaUrl)) {
    return unavailable();
  }
  return await loadLocalWebMedia(
    mediaUrl,
    maxBytesOrOptions as number | WebMediaOptions | undefined,
    options as { localRoots?: readonly string[] | "any" } | undefined,
  );
}

export async function loadWebMediaRaw(
  mediaUrl: string,
  maxBytesOrOptions?: unknown,
  options?: unknown,
): Promise<WebMediaResult> {
  return await loadWebMedia(mediaUrl, maxBytesOrOptions, options);
}

/** Upstream records a trust marker for generated-HTML bytes staged into the media store. */
export async function markTrustedGeneratedHtmlPath(
  _filePath: string,
  _contents: Buffer,
): Promise<void> {}
