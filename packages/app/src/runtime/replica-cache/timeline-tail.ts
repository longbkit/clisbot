import type { AgentToolCallData, StreamItem } from "@/types/stream";
import { buildToolCallDisplayModel } from "@/utils/tool-call-display";

/**
 * What one session's offline tail keeps on the device (docs/features/offline/offline-cache.md).
 * Tool payloads are ~92% of a session's bytes and stay on the Host: a compacted item is lossy,
 * so the tail paints and the open path then refetches the real one.
 */
export const TAIL_MAX_BYTES = 256 * 1024;
export const REASONING_MAX_BYTES = 2 * 1024;
const TITLE_MAX_CHARS = 160;

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > TITLE_MAX_CHARS ? `${line.slice(0, TITLE_MAX_CHARS - 1)}…` : line;
}

/** The longest prefix of `text` that fits in `maxBytes` of UTF-8. */
export function truncateUtf8(text: string, maxBytes: number): string {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const isPair = code >= 0xd800 && code <= 0xdbff;
    let size = 3;
    if (code < 0x80) size = 1;
    else if (code < 0x800) size = 2;
    else if (isPair) size = 4;
    if (bytes + size > maxBytes) return text.slice(0, index);
    bytes += size;
    if (isPair) index += 1;
  }
  return text;
}

function errorLine(error: unknown): string {
  if (typeof error === "string") return oneLine(error);
  if (error instanceof Error) return oneLine(error.message);
  if (typeof error === "object" && error !== null && "message" in error)
    return oneLine(String(error.message));
  return oneLine(JSON.stringify(error) ?? "");
}

function compactToolCall(data: AgentToolCallData): AgentToolCallData {
  const summary = buildToolCallDisplayModel(data).summary;
  return {
    provider: data.provider,
    callId: data.callId,
    name: data.name,
    status: data.status,
    error: data.status === "failed" ? errorLine(data.error) : null,
    detail: summary ? { type: "plain_text", label: oneLine(summary) } : { type: "plain_text" },
  };
}

/** The item as the tail stores it; the same object when nothing was dropped. */
export function compactTailItem(item: StreamItem): StreamItem {
  switch (item.kind) {
    case "tool_call":
      if (item.payload.source !== "agent") return item;
      return { ...item, payload: { source: "agent", data: compactToolCall(item.payload.data) } };
    case "thought": {
      const text = truncateUtf8(item.text, REASONING_MAX_BYTES);
      return text === item.text ? item : { ...item, text };
    }
    case "user_message": {
      if (!item.images?.length && !item.attachments?.length) return item;
      const { images: _images, attachments: _attachments, ...text } = item;
      return text;
    }
    default:
      return item;
  }
}

/** The newest items whose summed size fits in `maxBytes`, oldest first. */
export function keepNewestWithinBytes<Item>(
  items: readonly Item[],
  sizeOf: (item: Item) => number,
  maxBytes: number,
): Item[] {
  let bytes = 0;
  let start = items.length;
  while (start > 0) {
    const size = sizeOf(items[start - 1]);
    if (bytes + size > maxBytes) break;
    bytes += size;
    start -= 1;
  }
  return items.slice(start);
}
