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

/** A Hub signed out explicitly on this device; `accountId` is who, when that was known. */
export interface SignOutMark {
  accountId: string | null;
}
export type SignOutMarks = Readonly<Record<string, SignOutMark>>;

/**
 * Whether `reader` is the account that signed out and so must not be read as the reader: while a
 * sign-out is marked, a signed-in answer for that same account is stale (a refetch still in
 * flight, or one that failed). Another account is a new sign-in.
 */
export function isSignedOutReader(
  marks: SignOutMarks,
  reader: { origin: string | null; id: string | null | undefined },
): boolean {
  const mark = reader.origin === null ? undefined : marks[reader.origin];
  return mark !== undefined && (mark.accountId === null || mark.accountId === reader.id);
}

interface ReaderMemoryState {
  readers: RememberedReaders;
  /** Never persisted. Ends with a different account, a completed sign-in or the Hub's word. */
  signedOut: SignOutMarks;
  remember: (reader: RememberedReader) => void;
  /** An explicit sign-out. `accountId` is the account that was signed in, if known. */
  forget: (origin: string, accountId?: string | null) => void;
  /** An explicit sign-in on this Hub completed: what the account query says now is current. */
  acknowledgeSignIn: (origin: string) => void;
  /** The Hub answered that nobody is signed in: a later signed-in answer is a new sign-in. */
  confirmSignedOut: (origin: string) => void;
}

function withoutMark(marks: SignOutMarks, origin: string): SignOutMarks {
  if (!(origin in marks)) return marks;
  const { [origin]: _ended, ...rest } = marks;
  return rest;
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
          const marks = state.signedOut;
          if (isSignedOutReader(marks, reader)) return state;
          // A different account than the one that signed out is necessarily a new sign-in.
          const signedOut = withoutMark(marks, reader.origin);
          const readers = rememberReader(state.readers, reader);
          return readers === state.readers && signedOut === marks ? state : { readers, signedOut };
        }),
      forget: (origin, accountId) =>
        set((state) => ({
          readers: forgetReader(state.readers, origin),
          signedOut: {
            ...state.signedOut,
            [origin]: { accountId: accountId ?? state.readers[origin]?.id ?? null },
          },
        })),
      acknowledgeSignIn: (origin) =>
        set((state) => {
          const signedOut = withoutMark(state.signedOut, origin);
          return signedOut === state.signedOut ? state : { signedOut };
        }),
      confirmSignedOut: (origin) =>
        set((state) => {
          const signedOut = withoutMark(state.signedOut, origin);
          return signedOut === state.signedOut ? state : { signedOut };
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
