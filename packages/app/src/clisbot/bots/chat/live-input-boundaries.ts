import type { StreamItem } from "@/types/stream";

/** Exact canonical ingress IDs are the boundary; text and timestamps cannot locate an input. */
export function splitLiveInputBoundaries(
  items: readonly StreamItem[],
  inputIds: ReadonlySet<string>,
): { before: { messageId: string; items: StreamItem[] }[]; trailing: StreamItem[] } {
  const before: { messageId: string; items: StreamItem[] }[] = [];
  let start = 0;
  for (const [index, item] of items.entries()) {
    if (item.kind !== "user_message") continue;
    const messageId = item.clientMessageId ?? item.messageId;
    if (!messageId || !inputIds.has(messageId)) continue;
    if (index > start) before.push({ messageId, items: items.slice(start, index) });
    // Retain the owning prompt as context; visibility filtering removes user items.
    start = index;
  }
  return { before, trailing: items.slice(start) };
}
