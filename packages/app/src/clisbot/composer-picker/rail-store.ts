import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/**
 * The panel's provider rail, per device: whether it shows names, and the user's provider order.
 * Favorites stays pinned first and Profiles last; a provider the Host adds later joins the end.
 */
const STORAGE_KEY = "composer-provider-rail";

/** Below this window width the expanded rail would crowd the model list. */
export const WIDE_RAIL_MIN_WINDOW_WIDTH = 1200;

interface ProviderRailState {
  /** Null until the user chooses; the window width decides until then. */
  expanded: boolean | null;
  order: string[];
  setExpanded: (expanded: boolean) => void;
  move: (shownIds: readonly string[], id: string, delta: -1 | 1) => void;
}

const PersistedSchema = z.strictObject({
  expanded: z.boolean().nullable(),
  order: z.array(z.string()),
});

export function resolveRailExpanded(stored: boolean | null, windowWidth: number): boolean {
  return stored ?? windowWidth >= WIDE_RAIL_MIN_WINDOW_WIDTH;
}

export function orderProviderIds(available: readonly string[], saved: readonly string[]): string[] {
  const known = saved.filter((id) => available.includes(id));
  return [...known, ...available.filter((id) => !known.includes(id))];
}

export function moveProvider(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

export const useProviderRailStore = create<ProviderRailState>()(
  persist(
    (set) => ({
      expanded: null,
      order: [],
      setExpanded: (expanded) => set({ expanded }),
      move: (shownIds, id, delta) => set({ order: moveProvider(shownIds, id, delta) }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, PersistedSchema),
      partialize: (state) => ({ expanded: state.expanded, order: state.order }),
    },
  ),
);
