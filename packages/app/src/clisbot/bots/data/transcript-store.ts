import { create } from "zustand";
import type { ChatMessage } from "./contracts";

/**
 * Loaded transcript pages per chat, in memory for the app's lifetime (plans/app.md §6
 * "Offline"). Fed by `chat.transcript.fetch` pages and `chat.transcript.appended` pushes; the
 * daemon is the only writer of the transcript itself, so the store only merges.
 */
export interface ChatTranscript {
  messages: ChatMessage[];
  hasOlder: boolean;
}

interface TranscriptStoreState {
  transcripts: Record<string, ChatTranscript>;
  /** Replaces the loaded window (first page, reload). */
  replacePage: (key: string, page: ChatTranscript) => void;
  /** Older lines reached at the top; duplicates by id are dropped. */
  prependOlder: (key: string, messages: readonly ChatMessage[], hasOlder: boolean) => void;
  /** A pushed line; a repeat of an id already held is ignored. */
  append: (key: string, message: ChatMessage) => void;
  clear: (key: string) => void;
}

export function transcriptKey(serverId: string, chatId: string): string {
  return `${serverId}:${chatId}`;
}

const EMPTY_TRANSCRIPT: ChatTranscript = { messages: [], hasOlder: false };

/** Merges by message id, ordered by `seq`; the daemon's order wins over arrival order. */
export function mergeTranscriptMessages(
  existing: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of existing) byId.set(message.id, message);
  let changed = false;
  for (const message of incoming) {
    if (byId.has(message.id)) continue;
    byId.set(message.id, message);
    changed = true;
  }
  if (!changed) return existing as ChatMessage[];
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

export const useTranscriptStore = create<TranscriptStoreState>()((set) => ({
  transcripts: {},
  replacePage: (key, page) =>
    set((state) => ({
      transcripts: {
        ...state.transcripts,
        [key]: {
          // A push may arrive while the page RPC is in flight. Keep only lines newer than
          // the fetched window, rather than dropping an already acknowledged live answer.
          messages: mergeTranscriptMessages(
            page.messages,
            (state.transcripts[key]?.messages ?? []).filter(
              (line) => line.seq > (page.messages.at(-1)?.seq ?? 0),
            ),
          ),
          hasOlder: page.hasOlder,
        },
      },
    })),
  prependOlder: (key, messages, hasOlder) =>
    set((state) => {
      const current = state.transcripts[key] ?? EMPTY_TRANSCRIPT;
      return {
        transcripts: {
          ...state.transcripts,
          [key]: { messages: mergeTranscriptMessages(current.messages, messages), hasOlder },
        },
      };
    }),
  append: (key, message) =>
    set((state) => {
      const current = state.transcripts[key] ?? EMPTY_TRANSCRIPT;
      const messages = mergeTranscriptMessages(current.messages, [message]);
      if (messages === current.messages) return state;
      return { transcripts: { ...state.transcripts, [key]: { ...current, messages } } };
    }),
  clear: (key) =>
    set((state) => {
      const { [key]: _removed, ...transcripts } = state.transcripts;
      return { transcripts };
    }),
}));

export function selectTranscript(state: TranscriptStoreState, key: string): ChatTranscript {
  return state.transcripts[key] ?? EMPTY_TRANSCRIPT;
}
