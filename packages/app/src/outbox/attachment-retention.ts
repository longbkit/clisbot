import { retainAttachmentForGarbageCollection } from "@/attachments/gc-retention";
import { composerAttachmentIds } from "@/composer/attachment-references";
import type { OutboxEntry } from "./model";

const releases = new Map<string, Array<() => void>>();

/** An unsent message keeps its local image bytes until it is sent or deleted. */
export function retainOutboxAttachments(entry: OutboxEntry): void {
  if (releases.has(entry.clientMessageId)) return;
  releases.set(
    entry.clientMessageId,
    Array.from(composerAttachmentIds(entry.attachments), retainAttachmentForGarbageCollection),
  );
}

export function releaseOutboxAttachments(clientMessageId: string): void {
  for (const release of releases.get(clientMessageId) ?? []) release();
  releases.delete(clientMessageId);
}
