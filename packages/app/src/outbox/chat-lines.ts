import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { AttachmentMetadata } from "@/attachments/types";
import type { ChatMessage } from "@/clisbot/bots/data/contracts";
import { splitComposerAttachmentsForSubmit } from "@/composer/attachments/submit";
import { type OutboxEntry, selectTargetEntries } from "./model";
import { useOutboxStore } from "./store";

/** The line an unsent chat message shows until the transcript line with its id arrives. */
export function outboxChatLine(entry: OutboxEntry, seq: number): ChatMessage {
  const wire = splitComposerAttachmentsForSubmit(entry.attachments);
  return {
    id: entry.clientMessageId,
    seq,
    at: new Date(entry.createdAt).toISOString(),
    sender: { kind: "user" },
    text: entry.text,
    ...(wire.attachments.length > 0 ? { attachments: wire.attachments } : {}),
  };
}

/** Local image bytes of an unsent message, shown before the Host has stored them. */
export function outboxLocalImages(entry: OutboxEntry): AttachmentMetadata[] {
  return splitComposerAttachmentsForSubmit(entry.attachments).images;
}

/** Unsent and just-accepted lines after the transcript, each until a line with its id arrives. */
export function mergeChatOutboxLines(
  transcript: readonly ChatMessage[],
  pending: readonly OutboxEntry[],
): readonly ChatMessage[] {
  if (pending.length === 0) return transcript;
  const ids = new Set(transcript.map((line) => line.id));
  const lastSeq = transcript.at(-1)?.seq ?? 0;
  const local = pending
    .filter((entry) => !ids.has(entry.clientMessageId))
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((entry, index) => outboxChatLine(entry, lastSeq + index + 1));
  return local.length > 0 ? [...transcript, ...local] : transcript;
}

/**
 * The transcript with this chat's unsent and just-accepted messages after it. A transcript line
 * with the same id replaces the local one; accepted lines it replaced are forgotten.
 */
export function useChatLinesWithOutbox(
  serverId: string,
  chatId: string,
  transcript: readonly ChatMessage[],
): readonly ChatMessage[] {
  const target = useMemo(() => ({ kind: "chat" as const, serverId, chatId }), [serverId, chatId]);
  const pending = useOutboxStore(
    useShallow((state) => [
      ...selectTargetEntries(state.accepted, target),
      ...selectTargetEntries(state.entries, target),
    ]),
  );
  const lines = useMemo(() => mergeChatOutboxLines(transcript, pending), [pending, transcript]);
  useEffect(() => {
    const ids = new Set(transcript.map((line) => line.id));
    const replaced = pending
      .map((entry) => entry.clientMessageId)
      .filter((id) => ids.has(id) && useOutboxStore.getState().accepted[id]);
    if (replaced.length > 0) useOutboxStore.getState().forgetAccepted(replaced);
  }, [pending, transcript]);
  return lines;
}
