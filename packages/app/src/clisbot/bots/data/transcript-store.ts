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

/** Object identity is the read admission: clear/recreate and a newer read invalidate it. */
export interface TranscriptRead {
  readonly afterSeq?: number;
  readonly principalScope?: string;
}

interface TranscriptStoreState {
  transcripts: Record<string, ChatTranscript>;
  /** Fetch coverage, independent of live pushes and of the view's selected transcript. */
  reads: Record<string, TranscriptRead>;
  beginRead: (key: string, principalScope?: string) => TranscriptRead;
  acceptsRead: (key: string, read: TranscriptRead) => boolean;
  acceptRead: (key: string, read: TranscriptRead, page: ChatTranscript, delta: boolean) => void;
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

function tailWindow(current: ChatTranscript | undefined, page: ChatTranscript): ChatTranscript {
  return {
    // Keep pushes newer than the fetched window, including pushes arriving during first load.
    messages: mergeTranscriptMessages(
      page.messages,
      (current?.messages ?? []).filter((line) => line.seq > (page.messages.at(-1)?.seq ?? 0)),
    ),
    hasOlder: page.hasOlder,
  };
}

export const useTranscriptStore = create<TranscriptStoreState>()((set, get) => ({
  transcripts: {},
  reads: {},
  beginRead: (key, principalScope) => {
    const state = get();
    const samePrincipal = state.reads[key]?.principalScope === principalScope;
    const read = {
      afterSeq: samePrincipal && state.transcripts[key] ? state.reads[key]?.afterSeq : undefined,
      principalScope,
    };
    const { [key]: _previous, ...withoutPrevious } = state.transcripts;
    set({
      reads: { ...state.reads, [key]: read },
      transcripts: samePrincipal ? state.transcripts : withoutPrevious,
    });
    return read;
  },
  acceptsRead: (key, read) => get().reads[key] === read,
  acceptRead: (key, read, page, delta) =>
    set((state) => {
      if (state.reads[key] !== read) return state;
      const current = state.transcripts[key];
      let transcript: ChatTranscript;
      if (delta) {
        if (!current || read.afterSeq === undefined) return state;
        const messages = mergeTranscriptMessages(current.messages, page.messages);
        transcript = messages === current.messages ? current : { ...current, messages };
      } else {
        transcript = tailWindow(current, page);
      }
      const afterSeq = page.messages.at(-1)?.seq ?? (delta ? read.afterSeq : 0);
      if (transcript === current && afterSeq === read.afterSeq) return state;
      return {
        reads: { ...state.reads, [key]: { afterSeq, principalScope: read.principalScope } },
        transcripts:
          transcript === current ? state.transcripts : { ...state.transcripts, [key]: transcript },
      };
    }),
  replacePage: (key, page) =>
    set((state) => ({
      reads: { ...state.reads, [key]: { afterSeq: page.messages.at(-1)?.seq ?? 0 } },
      transcripts: {
        ...state.transcripts,
        [key]: tailWindow(state.transcripts[key], page),
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
      const { [key]: _read, ...reads } = state.reads;
      return { transcripts, reads };
    }),
}));

export function selectTranscript(state: TranscriptStoreState, key: string): ChatTranscript {
  return state.transcripts[key] ?? EMPTY_TRANSCRIPT;
}
