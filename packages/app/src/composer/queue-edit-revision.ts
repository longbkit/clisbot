import type { InputQueueView } from "@clisbot/protocol/input-queue";

/** Queue position is not edit identity; only the original item's content/state can conflict. */
export function queueEditRevision(
  id: string,
  original: string,
  view: InputQueueView,
): number | null {
  const item = view.items.find((candidate) => candidate.id === id);
  return item?.state === "queued" && JSON.stringify(item) === original ? view.revision : null;
}
