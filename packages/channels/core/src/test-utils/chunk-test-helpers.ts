// upstream: src/test-utils/chunk-test-helpers.ts@5d8067a4483
import { expectDefined } from "../normalization-core/expect.js"; /** Markdown chunk helpers shared by prompt and streaming tests. */
export function countLines(text: string): number {
  return text.split("\n").length;
}

export function hasBalancedFences(chunk: string): boolean {
  let open: { markerChar: string; markerLen: number } | null = null;
  for (const line of chunk.split("\n")) {
    const match = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
    if (!match) {
      continue;
    }
    const marker = expectDefined(match[2], "chunk test helpers regex capture 2");
    if (!open) {
      open = { markerChar: marker.charAt(0), markerLen: marker.length };
      continue;
    }
    if (open.markerChar === marker[0] && marker.length >= open.markerLen) {
      open = null;
    }
  }
  return open === null;
}
