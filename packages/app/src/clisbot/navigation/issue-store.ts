import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { IssueRecords } from "./issues";

const IssueRecordSchema = z.object({
  kind: z.enum(["failure", "needs"]),
  occurrence: z.string(),
  observedAt: z.string(),
  mark: z.enum(["seen", "unread", "dismissed"]).optional(),
  seenAt: z.string().optional(),
});

interface IssueStoreState {
  /** Principal scope (`useResourcePrincipalScope`) → session key → record. */
  scopes: Record<string, IssueRecords>;
  hydrated: boolean;
  /** Applies a pure transition to one principal's records; ignored until storage has loaded. */
  update: (scope: string, transition: (records: IssueRecords) => IssueRecords) => void;
}

const EMPTY: IssueRecords = {};

/** Per-user, per-device seen/dismissed marks. Cross-device sync is Round 2. */
export function createIssueStore(storage: StateStorage = AsyncStorage) {
  const store = create<IssueStoreState>()(
    persist(
      (set) => ({
        scopes: {},
        hydrated: false,
        update: (scope, transition) =>
          set((state) => {
            // Writing before the read returns would replace stored marks with an empty map.
            if (!state.hydrated) return state;
            const current = state.scopes[scope] ?? EMPTY;
            const next = transition(current);
            return next === current ? state : { scopes: { ...state.scopes, [scope]: next } };
          }),
      }),
      {
        name: "clisbot-navigation-issues",
        storage: createValidatedPersistStorage(
          storage,
          z.object({ scopes: z.record(z.string(), z.record(z.string(), IssueRecordSchema)) }),
        ),
        partialize: (state) => ({ scopes: state.scopes }),
        // A failed read leaves the store read-only for this run rather than overwrite storage.
        onRehydrateStorage: () => (_state, error) => {
          if (!error) queueMicrotask(() => store.setState({ hydrated: true }));
        },
      },
    ),
  );
  return store;
}

export const useIssueStore = createIssueStore();

export function selectIssueRecords(scope: string) {
  return (state: IssueStoreState) => state.scopes[scope] ?? EMPTY;
}
