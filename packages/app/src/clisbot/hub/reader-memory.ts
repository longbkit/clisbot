import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/**
 * The account this device last verified for a Hub: who the reader is there, kept so a moment
 * with no live answer (the Hub unreachable, the account still loading, a sign-in that lapsed)
 * does not change whose sessions are whose. Kept per Hub origin, replaced by the next verified
 * sign-in and removed only by an explicit sign-out. It is used to classify authorship only,
 * never to authorize anything.
 */
export interface RememberedReader {
  origin: string;
  aliases: string[];
  id: string;
  memberId: string | null;
}
export type RememberedReaders = Readonly<Record<string, RememberedReader>>;

export function rememberReader(
  readers: RememberedReaders,
  reader: RememberedReader,
): RememberedReaders {
  const current = readers[reader.origin];
  if (
    current &&
    current.id === reader.id &&
    current.memberId === reader.memberId &&
    current.aliases.join("\n") === reader.aliases.join("\n")
  )
    return readers;
  return { ...readers, [reader.origin]: reader };
}

export function forgetReader(readers: RememberedReaders, origin: string): RememberedReaders {
  if (!(origin in readers)) return readers;
  const { [origin]: _forgotten, ...rest } = readers;
  return rest;
}

const PersistedSchema = z.object({
  readers: z.record(
    z.string(),
    z.object({
      origin: z.string(),
      aliases: z.array(z.string()),
      id: z.string(),
      memberId: z.string().nullable(),
    }),
  ),
});

interface ReaderMemoryState {
  readers: RememberedReaders;
  /**
   * Hubs signed out explicitly on this device, until the Hub confirms nobody is signed in. While
   * set, a signed-in answer is stale (a refetch still in flight, or one that failed) and must
   * not bring the reader back. Never persisted.
   */
  signedOut: Readonly<Record<string, true>>;
  remember: (reader: RememberedReader) => void;
  forget: (origin: string) => void;
  /** The Hub answered that nobody is signed in: a later signed-in answer is a new sign-in. */
  confirmSignedOut: (origin: string) => void;
}

/** Set by a merge that changed what storage holds, so hydration writes it back. */
let rewriteAfterHydration = false;

export const useReaderMemory = create<ReaderMemoryState>()(
  persist(
    (set) => ({
      readers: {},
      signedOut: {},
      remember: (reader) =>
        set((state) => {
          if (state.signedOut[reader.origin]) return state;
          const readers = rememberReader(state.readers, reader);
          return readers === state.readers ? state : { readers };
        }),
      forget: (origin) =>
        set((state) => ({
          readers: forgetReader(state.readers, origin),
          signedOut: { ...state.signedOut, [origin]: true },
        })),
      confirmSignedOut: (origin) =>
        set((state) => {
          if (!state.signedOut[origin]) return state;
          const { [origin]: _confirmed, ...signedOut } = state.signedOut;
          return { signedOut };
        }),
    }),
    {
      name: "clisbot-hub-readers",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, PersistedSchema),
      partialize: (state) => ({ readers: state.readers }),
      // Storage is read after the app has started. What happened meanwhile wins: a reader
      // verified while loading replaces the stored one, and one signed out is not restored.
      merge: (persisted, current) => {
        const stored = (persisted as { readers?: RememberedReaders } | undefined)?.readers ?? {};
        const restored = Object.fromEntries(
          Object.entries(stored).filter(([origin]) => !current.signedOut[origin]),
        );
        const readers = { ...restored, ...current.readers };
        rewriteAfterHydration =
          Object.keys(readers).length !== Object.keys(stored).length ||
          Object.keys(current.readers).length > 0;
        return { ...current, readers };
      },
      onRehydrateStorage: () => () => {
        // Hydration does not write back (validated-persist-storage.ts); a merge that changed
        // what is stored must, or a signed-out reader returns on the next start.
        if (!rewriteAfterHydration) return;
        rewriteAfterHydration = false;
        queueMicrotask(() =>
          useReaderMemory.setState((state) => ({ readers: { ...state.readers } })),
        );
      },
    },
  ),
);
