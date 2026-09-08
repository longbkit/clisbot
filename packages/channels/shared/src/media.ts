// COMPAT(clisbot-control-plane): shared inbound-media helpers (group G,
// G1–G6) — one stream-to-disk download + the `[Attached files]` manifest the
// L2 transports fold into the inbound event body. The manifest is the agent's
// attachment reference: absolute paths the agent toolchain can read.

import { mkdir, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** One downloaded inbound attachment as the manifest + agent reference. */
export interface InboundAttachedFile {
  /** The human/agent-facing name (the document's file_name, else the kind). */
  name: string;
  /** The carrier kind (`"photo"` / `"document"` / `"audio"` / …). */
  kind: string;
  /** The bytes actually written to disk. */
  bytes: number;
  /** The absolute path the file was saved under. */
  path: string;
}

/** The shared inbound-media download floor (a per-file 10-minute cap): a
 * hung fetch must never stall a transport's event batch. Both verticals'
 * inbound-media folds compose this into their per-file abort signal. */
export const MEDIA_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/** An inbound file the caller's `maxBytes` ceiling refuses. Thrown BEFORE the
 * bytes are on disk, so an oversized attachment costs the transport a partial
 * write it immediately removes and never a full-size file. `declaredBytes` is
 * the `Content-Length` when the refusal happened on the header. */
export class MediaTooLargeError extends Error {
  readonly maxBytes: number;
  readonly declaredBytes: number | undefined;
  constructor(maxBytes: number, declaredBytes?: number) {
    super(
      `media download exceeds the ${maxBytes}-byte cap` +
        (declaredBytes === undefined ? "" : ` (Content-Length ${declaredBytes})`),
    );
    this.name = "MediaTooLargeError";
    this.maxBytes = maxBytes;
    this.declaredBytes = declaredBytes;
  }
}

/** Stream `url` to `dir/fileName` without buffering the file in memory:
 * `fetch` → `Readable.fromWeb` → `pipeline` into a write stream. Ensures
 * `dir` exists; on any failure removes the partial file and rethrows.
 * `headers` ride verbatim (the Slack half sends the Bearer bot token; the
 * Telegram half's Bot API URLs carry the token in the path).
 *
 * `maxBytes` is the disk ceiling and every inbound caller passes one: the
 * remote decides the size of an inbound attachment, so without a ceiling one
 * message fills the Hub's disk. It is checked twice — once on `Content-Length`
 * so an honest oversized file costs no bytes at all, and once per chunk so a
 * missing or lying `Content-Length` cannot get past it. Crossing the ceiling
 * mid-stream aborts the pipeline and removes the partial file. */
export async function downloadMediaFile(params: {
  url: string;
  dir: string;
  fileName: string;
  maxBytes?: number;
  fetchImpl?: typeof globalThis.fetch;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}): Promise<{ bytes: number; path: string }> {
  const { url, dir, fileName, maxBytes } = params;
  const fetchFn = params.fetchImpl ?? globalThis.fetch;
  await mkdir(dir, { recursive: true });
  const path = `${dir}/${fileName}`;
  const response = await fetchFn(url, {
    method: "GET",
    ...(params.headers !== undefined ? { headers: params.headers } : {}),
    ...(params.signal !== undefined ? { signal: params.signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`media download failed: HTTP ${response.status}`);
  }
  if (response.body === null) {
    throw new Error("media download failed: empty response body");
  }
  if (maxBytes !== undefined) {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body.cancel().catch(() => undefined);
      throw new MediaTooLargeError(maxBytes, declared);
    }
  }
  let bytes = 0;
  try {
    const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
    body.on("data", (chunk: Buffer | string) => {
      bytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      if (maxBytes !== undefined && bytes > maxBytes) {
        body.destroy(new MediaTooLargeError(maxBytes));
      }
    });
    const out = createWriteStream(path);
    await pipeline(body, out);
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
  return { bytes, path };
}

/** The `[Attached files]` block: one numbered line per file, absolute paths.
 * `""` when there are no files. */
export function buildAttachedFilesManifest(files: InboundAttachedFile[]): string {
  if (files.length === 0) return "";
  const lines = files.map(
    (file, i) => `${i + 1}. ${file.name} (${file.kind}, ${file.bytes} bytes) → ${file.path}`,
  );
  return `[Attached files]\n${lines.join("\n")}`;
}

/** Caption text + blank-line separator + manifest. Manifest-only when the
 * body is empty; body-only when the manifest is empty. */
export function foldAttachedFilesIntoBody(body: string, manifest: string): string {
  const trimmedBody = body.trim();
  if (trimmedBody === "" && manifest === "") return "";
  if (manifest === "") return body;
  if (trimmedBody === "") return manifest;
  return `${trimmedBody}\n\n${manifest}`;
}
