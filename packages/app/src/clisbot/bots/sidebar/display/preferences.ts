// What the Bots and Group chats sections show on each row and which Hosts they list: the
// counterpart of the Projects display menu for the fusion sections. A device preference, kept
// apart from the upstream sidebar settings so those stay untouched.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { z } from "zod";

export const BOT_ROW_ITEMS = ["host", "provider", "model", "mode", "thinking", "role"] as const;
export type BotRowItem = (typeof BOT_ROW_ITEMS)[number];

export const CHAT_ROW_ITEMS = ["host", "memberCount", "members"] as const;
export type ChatRowItem = (typeof CHAT_ROW_ITEMS)[number];

export type SidebarSection = "bots" | "chats";

export const DEFAULT_BOT_ROW_ITEMS: Record<BotRowItem, boolean> = {
  host: true,
  provider: true,
  model: false,
  mode: true,
  thinking: true,
  role: false,
};

export const DEFAULT_CHAT_ROW_ITEMS: Record<ChatRowItem, boolean> = {
  host: true,
  memberCount: true,
  members: false,
};

interface StoredDisplay {
  botRowItems: Record<BotRowItem, boolean>;
  chatRowItems: Record<ChatRowItem, boolean>;
  /** Hosts each section lists; empty lists every Host. */
  hostFilters: Record<SidebarSection, string[]>;
}

interface DisplayStore extends StoredDisplay {
  toggleBotRowItem: (item: BotRowItem) => void;
  toggleChatRowItem: (item: ChatRowItem) => void;
  toggleHostFilter: (section: SidebarSection, serverId: string) => void;
  clearHostFilter: (section: SidebarSection) => void;
}

const StoredSchema = z.object({
  botRowItems: z.record(z.string(), z.boolean()).optional(),
  chatRowItems: z.record(z.string(), z.boolean()).optional(),
  hostFilters: z.record(z.string(), z.array(z.string())).optional(),
});

const DEFAULTS: StoredDisplay = {
  botRowItems: DEFAULT_BOT_ROW_ITEMS,
  chatRowItems: DEFAULT_CHAT_ROW_ITEMS,
  hostFilters: { bots: [], chats: [] },
};

export function createSidebarDisplayStore(storage: StateStorage = AsyncStorage) {
  return create<DisplayStore>()(
    persist(
      (set) => ({
        ...DEFAULTS,
        toggleBotRowItem: (item) =>
          set((state) => ({
            botRowItems: { ...state.botRowItems, [item]: !state.botRowItems[item] },
          })),
        toggleChatRowItem: (item) =>
          set((state) => ({
            chatRowItems: { ...state.chatRowItems, [item]: !state.chatRowItems[item] },
          })),
        toggleHostFilter: (section, serverId) =>
          set((state) => {
            const current = state.hostFilters[section];
            const next = current.includes(serverId)
              ? current.filter((id) => id !== serverId)
              : [...current, serverId];
            return { hostFilters: { ...state.hostFilters, [section]: next } };
          }),
        clearHostFilter: (section) =>
          set((state) => ({ hostFilters: { ...state.hostFilters, [section]: [] } })),
      }),
      {
        name: "fusion-sidebar-display",
        // `merge` validates what was read; a record it cannot parse leaves the defaults.
        storage: createJSONStorage(() => storage),
        partialize: ({ botRowItems, chatRowItems, hostFilters }) => ({
          botRowItems,
          chatRowItems,
          hostFilters,
        }),
        // A stored record only overrides the keys it has, so an item added later keeps its default.
        merge: (persisted, current) => mergeStored(persisted, current),
      },
    ),
  );
}

function mergeStored(persisted: unknown, current: DisplayStore): DisplayStore {
  const stored = StoredSchema.safeParse(persisted);
  if (!stored.success) return current;
  const { botRowItems = {}, chatRowItems = {}, hostFilters = {} } = stored.data;
  return {
    ...current,
    botRowItems: { ...current.botRowItems, ...pick(botRowItems, BOT_ROW_ITEMS) },
    chatRowItems: { ...current.chatRowItems, ...pick(chatRowItems, CHAT_ROW_ITEMS) },
    hostFilters: {
      bots: hostFilters.bots ?? current.hostFilters.bots,
      chats: hostFilters.chats ?? current.hostFilters.chats,
    },
  };
}

function pick<K extends string>(
  record: Record<string, boolean>,
  keys: readonly K[],
): Partial<Record<K, boolean>> {
  const picked: Partial<Record<K, boolean>> = {};
  for (const key of keys) if (typeof record[key] === "boolean") picked[key] = record[key];
  return picked;
}

export const useSidebarDisplayStore = createSidebarDisplayStore();

/**
 * Rows on the Hosts a section's filter keeps. An empty filter keeps every Host, and so does a
 * filter whose Hosts are all gone, so a removed Host cannot leave a section empty for good.
 */
export function filterByHost<T extends { serverId: string }>(
  rows: readonly T[],
  hostFilter: readonly string[],
  knownHosts: readonly string[],
): readonly T[] {
  const active = hostFilter.filter((serverId) => knownHosts.includes(serverId));
  return active.length === 0 ? rows : rows.filter((row) => active.includes(row.serverId));
}
