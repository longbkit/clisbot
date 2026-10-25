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
  showBotProjectsInWork: z.boolean().optional(),
  chatsSort: z.enum(["recent", "name"]).optional(),
  chatsSplit: z.boolean().optional(),
  chatsHosts: z.array(z.string()).optional(),
});

interface NavigationState {
  homeMode: HomeMode;
  scopes: Record<ScopedSection, OwnershipScope>;
  /** The list a session detail belongs to (Back target on a phone, pane on desktop). */
  lastList: ListSection;
  homeChip: HomeChip;
  chatsChip: ChatsChip;
  workChip: WorkChip;
  /** Chats' Display menu: order, the opt-in DM/group split, and the Hosts it lists. */
  chatsSort: "recent" | "name";
  chatsSplit: boolean;
  chatsHosts: string[];
  setChatsSort: (sort: "recent" | "name") => void;
  toggleChatsSplit: () => void;
  toggleChatsHost: (serverId: string) => void;
  clearChatsHosts: () => void;
  /** Bot home projects are Chats; Work lists them only when the reader opts in (brief C4). */
  showBotProjectsInWork: boolean;
  toggleBotProjectsInWork: () => void;
  /** Home shows other members' pins only after the reader asks (brief C8). */
  showOthersPins: boolean;
  /** Home's 🔍 swaps the feed for Inbox's full history and search. */
  homeSearchOpen: boolean;
  /** Home's Host filter; empty means every Host. */
  homeHosts: string[];
  /** Whether Home's collapsed Seen issues group is open. */
  seenIssuesOpen: boolean;
  setHomeMode: (mode: HomeMode) => void;
  setScope: (section: ScopedSection, scope: OwnershipScope) => void;
  setLastList: (list: ListSection) => void;
  setHomeChip: (chip: HomeChip) => void;
  setChatsChip: (chip: ChatsChip) => void;
  setWorkChip: (chip: WorkChip) => void;
  setShowOthersPins: (show: boolean) => void;
  setHomeSearchOpen: (open: boolean) => void;
  toggleHomeHost: (serverId: string) => void;
  clearHomeHosts: () => void;
  setSeenIssuesOpen: (open: boolean) => void;
}

function toggled(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
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
      showOthersPins: false,
      showBotProjectsInWork: false,
      chatsSort: "recent",
      chatsSplit: false,
      chatsHosts: [],
      setChatsSort: (chatsSort) => set({ chatsSort }),
      toggleChatsSplit: () => set((state) => ({ chatsSplit: !state.chatsSplit })),
      toggleChatsHost: (serverId) =>
        set((state) => ({ chatsHosts: toggled(state.chatsHosts, serverId) })),
      clearChatsHosts: () => set({ chatsHosts: [] }),
      toggleBotProjectsInWork: () =>
        set((state) => ({ showBotProjectsInWork: !state.showBotProjectsInWork })),
      homeSearchOpen: false,
      homeHosts: [],
      seenIssuesOpen: false,
      setHomeMode: (homeMode) => set({ homeMode }),
      setScope: (section, scope) =>
        set((state) => ({ scopes: { ...state.scopes, [section]: scope } })),
      setLastList: (lastList) => set({ lastList }),
      setHomeChip: (homeChip) => set({ homeChip }),
      setChatsChip: (chatsChip) => set({ chatsChip }),
      setWorkChip: (workChip) => set({ workChip }),
      setShowOthersPins: (showOthersPins) => set({ showOthersPins }),
      setHomeSearchOpen: (homeSearchOpen) => set({ homeSearchOpen }),
      toggleHomeHost: (serverId) =>
        set((state) => ({ homeHosts: toggled(state.homeHosts, serverId) })),
      clearHomeHosts: () => set({ homeHosts: [] }),
      setSeenIssuesOpen: (seenIssuesOpen) => set({ seenIssuesOpen }),
    }),
    {
      name: "clisbot-navigation-preferences",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedSchema),
      partialize: (state) => ({
        homeMode: state.homeMode,
        scopes: state.scopes,
        lastList: state.lastList,
        showBotProjectsInWork: state.showBotProjectsInWork,
        chatsSort: state.chatsSort,
        chatsSplit: state.chatsSplit,
        chatsHosts: state.chatsHosts,
      }),
    },
  ),
);
