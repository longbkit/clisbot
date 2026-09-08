// upstream: src/media/web-media.ts@5d8067a4483
// D-CORE-224: upstream's `web-media.ts` is ~1300 lines wired to OpenClaw's SSRF
// policy engine, pinned-dispatcher pool, media store, hosted-media resolver,
// image optimizer (rastermill) and generated-HTML trust boundary. Fusion channel
// transports own their own fetch stack and the Hub authorizes outbound files
// before they reach a vertical, so this module keeps upstream's `loadWebMedia`
// signature and `WebMediaResult` shape over a plain local-file / HTTP read.
// Image optimization is not performed; `optimizeImages` is accepted and ignored.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { kindFromMime, mimeTypeFromFilePath } from "../media-core/mime.js";
import type { MediaKind } from "../media-core/constants.js";

export type WebMediaResult = {
  buffer: Buffer;
  contentType?: string;
  kind: MediaKind | undefined;
  fileName?: string;
  /** Source bytes came from a generated-HTML trust boundary. */
  trustedGeneratedHtmlSource?: boolean;
};

export type WebMediaOptions = {
  maxBytes?: number;
  optimizeImages?: boolean;
  localRoots?: readonly string[] | "any";
  readFile?: (filePath: string) => Promise<Buffer>;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  requestInit?: RequestInit;
  workspaceDir?: string;
  [key: string]: unknown;
};

function assertWithinLimit(size: number, maxBytes: number | undefined, source: string): void {
  if (maxBytes !== undefined && size > maxBytes) {
    throw new Error(`Media at ${source} is ${size} bytes, over the ${maxBytes} byte limit`);
  }
}

function toResult(buffer: Buffer, contentType: string | undefined, fileName: string | undefined) {
  return {
    buffer,
    ...(contentType ? { contentType } : {}),
    kind: kindFromMime(contentType),
    ...(fileName ? { fileName } : {}),
  } satisfies WebMediaResult;
}

/** Loads local or remote media bytes for an outbound send. */
export async function loadWebMedia(
  mediaUrl: string,
  maxBytesOrOptions?: number | WebMediaOptions,
  options?: { localRoots?: readonly string[] | "any" },
): Promise<WebMediaResult> {
  const opts: WebMediaOptions =
    typeof maxBytesOrOptions === "number"
      ? { maxBytes: maxBytesOrOptions, ...options }
      : { ...maxBytesOrOptions, ...options };
  const isHttp = /^https?:\/\//i.test(mediaUrl);
  if (!isHttp) {
    const filePath = mediaUrl.replace(/^file:\/\//, "");
    const read = opts.readFile ?? ((path: string) => readFile(path));
    const buffer = await read(filePath);
    assertWithinLimit(buffer.byteLength, opts.maxBytes, filePath);
    return toResult(buffer, mimeTypeFromFilePath(filePath), basename(filePath));
  }
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(mediaUrl, opts.requestInit);
  if (!response.ok) {
    throw new Error(`Media fetch failed for ${mediaUrl}: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  assertWithinLimit(buffer.byteLength, opts.maxBytes, mediaUrl);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || undefined;
  const fileName = basename(new URL(mediaUrl).pathname) || undefined;
  return toResult(buffer, contentType ?? mimeTypeFromFilePath(mediaUrl), fileName);
}

/** Loads media without image optimization. Upstream distinguishes the two; Fusion never optimizes. */
export const loadWebMediaRaw = loadWebMedia;

const trustedGeneratedHtmlPaths = new Set<string>();

/** Marks a generated-HTML artifact path as trusted for a later outbound read. */
export function markTrustedGeneratedHtmlPath(filePath: string): void {
  trustedGeneratedHtmlPaths.add(filePath);
}

/** True when the path was marked by `markTrustedGeneratedHtmlPath`. */
export function isTrustedGeneratedHtmlPath(filePath: string): boolean {
  return trustedGeneratedHtmlPaths.has(filePath);
}
