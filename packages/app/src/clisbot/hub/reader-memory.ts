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
  remember: (reader: RememberedReader) => void;
  forget: (origin: string) => void;
}

export const useReaderMemory = create<ReaderMemoryState>()(
  persist(
    (set) => ({
      readers: {},
      remember: (reader) =>
        set((state) => {
          const readers = rememberReader(state.readers, reader);
          return readers === state.readers ? state : { readers };
        }),
      forget: (origin) =>
        set((state) => {
          const readers = forgetReader(state.readers, origin);
          return readers === state.readers ? state : { readers };
        }),
    }),
    {
      name: "clisbot-hub-readers",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, PersistedSchema),
      partialize: (state) => ({ readers: state.readers }),
    },
  ),
);
