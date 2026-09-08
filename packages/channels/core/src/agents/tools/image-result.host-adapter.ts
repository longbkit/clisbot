// Fusion-owned host adapter for the image-result half of
// `src/agents/tools/common.ts` (D-CORE-253).
//
// Upstream reads the file through OpenClaw's fs-safe root, sniffs the MIME type
// with `@openclaw/media-core`, then hands the result to
// `src/agents/tool-images.runtime.ts`, which re-encodes and downscales the image
// against the host's `ImageSanitizationLimits`. Fusion has no image
// sanitization pipeline, so this adapter keeps upstream's call signature and
// result shape (`content` image part, `details.media.mediaUrl`) over a plain
// bounded file read and returns the image unsanitized. The limits argument is
// accepted and ignored; wire it when the host grows a sanitizer.
import { readFile } from "node:fs/promises";
import { detectMime } from "../../media-core/mime.js";
import type { AgentToolResult } from "../runtime/index.host-adapter.js";

/** Upstream's per-tool image sanitization limits. Accepted and ignored here. */
export type ImageSanitizationLimits = {
  maxBytes?: number;
  maxDimension?: number;
  [key: string]: unknown;
};

export async function imageResultFromFile(params: {
  label: string;
  path: string;
  extraText?: string;
  details?: Record<string, unknown>;
  imageSanitization?: ImageSanitizationLimits;
}): Promise<AgentToolResult<unknown>> {
  const buf = await readFile(params.path);
  const mimeType = (await detectMime({ buffer: buf.subarray(0, 256) })) ?? "image/png";
  const content: AgentToolResult<unknown>["content"] = [
    ...(params.extraText ? [{ type: "text" as const, text: params.extraText }] : []),
    {
      type: "image",
      data: buf.toString("base64"),
      mimeType,
    },
  ];
  const detailsMedia =
    params.details?.media &&
    typeof params.details.media === "object" &&
    !Array.isArray(params.details.media)
      ? (params.details.media as Record<string, unknown>)
      : undefined;
  return {
    content,
    details: {
      path: params.path,
      ...params.details,
      media: {
        ...detailsMedia,
        mediaUrl: params.path,
      },
    },
  };
}
