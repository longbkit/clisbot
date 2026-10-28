import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { ChatsChip } from "./chat-list";
import type { HomeChip, HomeMode } from "./home-feed";
import type { OwnershipScope } from "./ownership";

export type ListSection = "chats" | "work";
export type WorkChip = "all" | "needs" | "running" | "done" | "failed";
export type ScopedSection = "home" | "chats" | "work";

const ScopeSchema = z.enum(["mine", "others", "all"]);
const PersistedSchema = z.object({
  homeMode: z.enum(["chat", "work", "hybrid"]),
  scopes: z.object({ home: ScopeSchema, chats: ScopeSchema, work: ScopeSchema }),
  lastList: z.enum(["chats", "work"]),
  workShowBots: z.boolean().optional(),
  chatsSort: z.enum(["recent", "name"]).optional(),
  chatsSplit: z.boolean().optional(),
});

interface NavigationState {
  homeMode: HomeMode;
  scopes: Record<ScopedSection, OwnershipScope>;
  /** The list a session detail belongs to (Back target on a phone, pane on desktop). */
  lastList: ListSection;
  homeChip: HomeChip;
  chatsChip: ChatsChip;
  workChip: WorkChip;
  /**
   * Chats' Display menu: order and the opt-in DM/group split. Which Hosts every list shows is the
   * one app-wide Host filter (`useSidebarViewStore.hostFilters`, `host-filter.ts`).
   */
  chatsSort: "recent" | "name";
  chatsSplit: boolean;
  setChatsSort: (sort: "recent" | "name") => void;
  toggleChatsSplit: () => void;
  /**
   * The Workspace list's Bots chip: Bot-labelled sessions (and so Bot home projects) are listed by
   * default; off hides them from the list, its counts and its scope tabs in one tap.
   */
  workShowBots: boolean;
  toggleWorkShowBots: () => void;
  /** Home's 🔍 swaps the feed for Inbox's full history and search. */
  homeSearchOpen: boolean;
  /** Whether Home's collapsed Seen issues group is open. */
  seenIssuesOpen: boolean;
  setHomeMode: (mode: HomeMode) => void;
  setScope: (section: ScopedSection, scope: OwnershipScope) => void;
  setLastList: (list: ListSection) => void;
  setHomeChip: (chip: HomeChip) => void;
  setChatsChip: (chip: ChatsChip) => void;
  setWorkChip: (chip: WorkChip) => void;
  setHomeSearchOpen: (open: boolean) => void;
  setSeenIssuesOpen: (open: boolean) => void;
}

export const useNavigationStore = create<NavigationState>()(
  persist(
    (set) => ({
      homeMode: "hybrid",
      scopes: { home: "mine", chats: "mine", work: "mine" },
      lastList: "work",
      homeChip: "all",
      chatsChip: "all",
      workChip: "all",
      workShowBots: true,
      chatsSort: "recent",
      chatsSplit: false,
      setChatsSort: (chatsSort) => set({ chatsSort }),
      toggleChatsSplit: () => set((state) => ({ chatsSplit: !state.chatsSplit })),
      toggleWorkShowBots: () => set((state) => ({ workShowBots: !state.workShowBots })),
      homeSearchOpen: false,
      seenIssuesOpen: false,
      setHomeMode: (homeMode) => set({ homeMode }),
      setScope: (section, scope) =>
        set((state) => ({ scopes: { ...state.scopes, [section]: scope } })),
      setLastList: (lastList) => set({ lastList }),
      setHomeChip: (homeChip) => set({ homeChip }),
      setChatsChip: (chatsChip) => set({ chatsChip }),
      setWorkChip: (workChip) => set({ workChip }),
      setHomeSearchOpen: (homeSearchOpen) => set({ homeSearchOpen }),
      setSeenIssuesOpen: (seenIssuesOpen) => set({ seenIssuesOpen }),
    }),
    {
      name: "clisbot-navigation-preferences",
      // v1: the Display menu's "Bot projects" switch (off by default) became the Bots chip (on by
      // default) — Bot sessions now show in the list, so the old choice is not carried over.
      // v2: Home opens on All (Owner, 2026-10-26); a stored Home scope moves to All once.
      // v3: Chats' own Host filter gave way to the app-wide one (Owner, 2026-10-26).
      // v4: every list opens on For me and keeps the reader's last choice (Owner, 2026-10-28);
      // v2's Home-to-All move was not a choice, so a stored Home scope goes back to For me once.
      version: 4,
      migrate: (persisted, version) => {
        const state = { ...((persisted ?? {}) as Record<string, unknown>) };
        if (version < 1) {
          delete state.showBotProjectsInWork;
          state.workShowBots = true;
        }
        const scopes = state.scopes as Record<string, unknown> | undefined;
        if (version < 2 && scopes) state.scopes = { ...scopes, home: "all" };
        if (version < 4) state.scopes = { ...(state.scopes as object), home: "mine" };
        delete state.chatsHosts;
        return state as unknown as NavigationState;
      },
      storage: createValidatedPersistStorage(AsyncStorage, PersistedSchema),
      partialize: (state) => ({
        homeMode: state.homeMode,
        scopes: state.scopes,
        lastList: state.lastList,
        workShowBots: state.workShowBots,
        chatsSort: state.chatsSort,
        chatsSplit: state.chatsSplit,
      }),
    },
  ),
);
