import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { composerAttachmentIds } from "@/composer/attachment-references";
import { releaseOutboxAttachments } from "./attachment-retention";
import type { OutboxEntry, OutboxFailure } from "./model";

interface OutboxState {
  entries: Record<string, OutboxEntry>;
  /**
   * Accepted chat lines still waiting for their transcript line. Memory only: after a restart the
   * transcript already holds them.
   */
  accepted: Record<string, OutboxEntry>;
  add: (entry: OutboxEntry) => void;
  accept: (clientMessageId: string) => void;
  forgetAccepted: (clientMessageIds: readonly string[]) => void;
  markSending: (clientMessageId: string) => void;
  markFailed: (clientMessageId: string, failure: OutboxFailure) => void;
  remove: (clientMessageId: string) => void;
}

function updateEntry(
  entries: Record<string, OutboxEntry>,
  clientMessageId: string,
  patch: (entry: OutboxEntry) => OutboxEntry,
): Record<string, OutboxEntry> {
  const entry = entries[clientMessageId];
  return entry ? { ...entries, [clientMessageId]: patch(entry) } : entries;
}

/**
 * Messages pressed but not yet accepted by their Host, kept across restarts. Entries leave when
 * the Host accepts them or the user deletes them; nothing else evicts them.
 */
export const useOutboxStore = create<OutboxState>()(
  persist(
    (set) => ({
      entries: {},
      accepted: {},
      add: (entry) =>
        set((state) => ({ entries: { ...state.entries, [entry.clientMessageId]: entry } })),
      accept: (clientMessageId) =>
        set((state) => {
          const entry = state.entries[clientMessageId];
          if (!entry) return state;
          const { [clientMessageId]: _, ...entries } = state.entries;
          return {
            entries,
            accepted: { ...state.accepted, [clientMessageId]: { ...entry, status: "sending" } },
          };
        }),
      forgetAccepted: (clientMessageIds) =>
        set((state) => {
          const forget = clientMessageIds.filter((id) => state.accepted[id]);
          if (forget.length === 0) return state;
          const accepted = { ...state.accepted };
          for (const id of forget) delete accepted[id];
          return { accepted };
        }),
      markSending: (clientMessageId) =>
        set((state) => ({
          entries: updateEntry(state.entries, clientMessageId, ({ failure: _, ...entry }) => ({
            ...entry,
            status: "sending",
          })),
        })),
      markFailed: (clientMessageId, failure) =>
        set((state) => ({
          entries: updateEntry(state.entries, clientMessageId, (entry) => ({
            ...entry,
            status: "failed",
            failure,
          })),
        })),
      remove: (clientMessageId) =>
        set((state) => {
          if (!state.entries[clientMessageId]) return state;
          const { [clientMessageId]: _, ...entries } = state.entries;
          return { entries };
        }),
    }),
    {
      name: "clisbot-outbox:v1",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ entries }) => ({ entries }),
    },
  ),
);

/** Resolves once persisted entries are loaded, so attachment cleanup never deletes their bytes. */
export function whenOutboxHydrated(): Promise<void> {
  if (useOutboxStore.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useOutboxStore.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}

export function collectOutboxAttachmentIds(): Set<string> {
  const ids = new Set<string>();
  for (const entry of Object.values(useOutboxStore.getState().entries)) {
    for (const id of composerAttachmentIds(entry.attachments)) ids.add(id);
  }
  return ids;
}

export function getOutboxEntry(clientMessageId: string): OutboxEntry | undefined {
  return useOutboxStore.getState().entries[clientMessageId];
}

/** The Host shows these messages: drop their entries, whatever the in-flight request reports. */
export function settleDeliveredOutboxEntries(clientMessageIds: readonly string[]): void {
  const { entries, remove } = useOutboxStore.getState();
  for (const id of clientMessageIds) {
    if (!entries[id]) continue;
    remove(id);
    releaseOutboxAttachments(id);
  }
}
