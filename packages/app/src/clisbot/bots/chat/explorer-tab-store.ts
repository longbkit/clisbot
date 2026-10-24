import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { readLegacyExplorerTabs } from "@/stores/panel-store/state";

export type ConversationExplorerTab = "changes" | "files" | "pr";
export interface ConversationExplorerCheckout {
  serverId: string;
  cwd: string;
  isGit: boolean;
}
const KEY = "conversation-explorer-tabs";
const TabsSchema = z.record(z.string(), z.enum(["changes", "files", "pr"]));
const PersistedSchema = z.object({ tabs: TabsSchema, legacyImported: z.literal(true) });
interface ExplorerTabsState {
  tabs: Record<string, ConversationExplorerTab>;
  legacyImported: true;
  flushHydrated: () => void;
  setTab: (checkout: ConversationExplorerCheckout, tab: ConversationExplorerTab) => void;
}

function checkoutKey(checkout: ConversationExplorerCheckout): string | null {
  const host = checkout.serverId.trim();
  const cwd = checkout.cwd.trim();
  return host && cwd ? `${host}::${cwd}` : null;
}
export function conversationExplorerTab(
  tabs: Readonly<Record<string, ConversationExplorerTab>>,
  checkout: ConversationExplorerCheckout,
): ConversationExplorerTab {
  const key = checkoutKey(checkout);
  const tab = (key ? tabs[key] : undefined) ?? (checkout.isGit ? "changes" : "files");
  return !checkout.isGit && tab === "changes" ? "files" : tab;
}

/** Import old checkout preferences once before upstream panel migration discards its UI state. */
export function conversationExplorerStorage(storage: StateStorage): StateStorage {
  return {
    setItem: (name, value) => storage.setItem(name, value),
    removeItem: (name) => storage.removeItem(name),
    async getItem(name) {
      const current = await storage.getItem(name);
      if (current !== null) return current;
      let tabs: Record<string, ConversationExplorerTab> = {};
      const legacy = await storage.getItem("panel-state");
      if (legacy) {
        try {
          const parsed = TabsSchema.safeParse(JSON.parse(legacy)?.state?.explorerTabByCheckout);
          if (parsed.success) tabs = parsed.data;
        } catch {
          // Malformed old panel data must not invalidate the independent shell preference.
        }
      }
      tabs = { ...readLegacyExplorerTabs(), ...tabs };
      const newer = await storage.getItem(name);
      if (newer !== null) return newer;
      const migrated = JSON.stringify({ state: { tabs, legacyImported: true }, version: 1 });
      await storage.setItem(name, migrated);
      return migrated;
    },
  };
}

export function createConversationExplorerTabs(storage: StateStorage) {
  return create<ExplorerTabsState>()(
    persist<ExplorerTabsState, [], [], z.infer<typeof PersistedSchema>>(
      (set) => ({
        tabs: {},
        legacyImported: true,
        // Persist the merged state after hydration has released its write guard.
        flushHydrated: () => set((state) => state),
        setTab: (checkout, requested) => {
          const key = checkoutKey(checkout);
          if (!key) return;
          const tab = !checkout.isGit && requested === "changes" ? "files" : requested;
          set((state) =>
            state.tabs[key] === tab ? state : { tabs: { ...state.tabs, [key]: tab } },
          );
        },
      }),
      {
        name: KEY,
        version: 1,
        storage: createValidatedPersistStorage(
          conversationExplorerStorage(storage),
          PersistedSchema,
        ),
        partialize: ({ tabs, legacyImported }) => ({ tabs, legacyImported }),
        merge: (persisted, current) => {
          const stored = PersistedSchema.safeParse(persisted);
          return {
            ...current,
            ...(stored.success ? stored.data : {}),
            tabs: { ...(stored.success ? stored.data.tabs : {}), ...current.tabs },
          };
        },
        onRehydrateStorage: () => (state, error) => {
          if (!error) state?.flushHydrated();
        },
      },
    ),
  );
}

export const useConversationExplorerTabs = createConversationExplorerTabs(AsyncStorage);
