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

/** Stream `url` to `dir/fileName` without buffering the file in memory:
 * `fetch` → `Readable.fromWeb` → `pipeline` into a write stream. Ensures
 * `dir` exists; on any failure removes the partial file and rethrows.
 * `headers` ride verbatim (the Slack half sends the Bearer bot token; the
 * Telegram half's Bot API URLs carry the token in the path). */
export async function downloadMediaFile(params: {
  url: string;
  dir: string;
  fileName: string;
  fetchImpl?: typeof globalThis.fetch;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}): Promise<{ bytes: number; path: string }> {
  const { url, dir, fileName } = params;
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
  let bytes = 0;
  try {
    const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
    body.on("data", (chunk: Buffer | string) => {
      bytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
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
