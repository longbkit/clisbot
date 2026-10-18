import { useMemo } from "react";
import { useSessionStore } from "@/stores/session-store";
import { queueComposerMessage, type QueueWriter, type QueuedComposerMessage } from "./actions";
import type { ComposerAttachment } from "@/attachments/types";

const EMPTY: QueuedComposerMessage[] = [];

/** Existing session-local queue owner; never migrate its accepted items to a Host queue. */
export function useClientInputQueue(serverId: string, agentId: string, sessionTarget: boolean) {
  const items = useSessionStore((state) =>
    sessionTarget ? (state.sessions[serverId]?.queuedMessages.get(agentId) ?? EMPTY) : EMPTY,
  );
  const writer = useMemo<QueueWriter>(
    () => ({
      read: (id) => useSessionStore.getState().sessions[serverId]?.queuedMessages.get(id) ?? EMPTY,
      write: (update) => useSessionStore.getState().setQueuedMessages(serverId, update),
    }),
    [serverId],
  );
  return useMemo(
    () => ({ items, ...createClientInputQueue(writer, agentId) }),
    [items, writer, agentId],
  );
}

export function createClientInputQueue(writer: QueueWriter, agentId: string) {
  return {
    writer,
    enqueue: (text: string, attachments: ComposerAttachment[]) =>
      queueComposerMessage({ agentId, text, attachments, queue: writer }),
    read: (id: string) => writer.read(agentId).find((item) => item.id === id),
    remove: (id: string) =>
      writer.write((previous) => {
        const next = new Map(previous);
        next.set(
          agentId,
          (previous.get(agentId) ?? EMPTY).filter((item) => item.id !== id),
        );
        return next;
      }),
    save: (
      id: string,
      original: string,
      text: string,
      attachments: ComposerAttachment[],
      move: boolean,
    ) => saveClientQueueEdit(writer, agentId, { id, original, text, attachments, move }),
  };
}

function saveClientQueueEdit(
  writer: QueueWriter,
  agentId: string,
  edit: {
    id: string;
    original: string;
    text: string;
    attachments: ComposerAttachment[];
    move: boolean;
  },
): boolean {
  let saved = false;
  writer.write((previous) => {
    const items = previous.get(agentId) ?? EMPTY;
    const item = items.find((value) => value.id === edit.id);
    if (!item || JSON.stringify(item) !== edit.original) return previous;
    const updated = { id: item.id, text: edit.text, attachments: edit.attachments };
    const next = new Map(previous);
    next.set(
      agentId,
      edit.move
        ? [...items.filter((value) => value.id !== edit.id), updated]
        : items.map((value) => (value.id === edit.id ? updated : value)),
    );
    saved = true;
    return next;
  });
  return saved;
}
