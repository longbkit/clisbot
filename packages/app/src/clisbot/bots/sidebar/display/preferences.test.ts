import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { createSidebarDisplayStore, DEFAULT_BOT_ROW_ITEMS, filterByHost } from "./preferences";

function memoryStorage(initial: Record<string, string> = {}): StateStorage {
  const data = { ...initial };
  return {
    getItem: (name) => data[name] ?? null,
    setItem: (name, value) => {
      data[name] = value;
    },
    removeItem: (name) => {
      delete data[name];
    },
  };
}

describe("sidebar display preferences", () => {
  it("keeps defaults for items a stored record lacks and ignores unknown keys", async () => {
    const stored = JSON.stringify({
      state: { botRowItems: { host: false, bogus: true }, hostFilters: { bots: ["h2"] } },
      version: 0,
    });
    const store = createSidebarDisplayStore(memoryStorage({ "fusion-sidebar-display": stored }));
    await store.persist.rehydrate();
    const state = store.getState();
    expect(state.botRowItems).toEqual({ ...DEFAULT_BOT_ROW_ITEMS, host: false });
    expect(state.hostFilters).toEqual({ bots: ["h2"], chats: [] });
  });

  it("toggles row items and Host filters per section", () => {
    const store = createSidebarDisplayStore(memoryStorage());
    store.getState().toggleChatRowItem("members");
    store.getState().toggleHostFilter("chats", "h1");
    expect(store.getState().chatRowItems.members).toBe(true);
    expect(store.getState().hostFilters).toEqual({ bots: [], chats: ["h1"] });
    store.getState().clearHostFilter("chats");
    expect(store.getState().hostFilters.chats).toEqual([]);
  });

  it("an empty Host filter keeps every row", () => {
    const rows = [{ serverId: "h1" }, { serverId: "h2" }];
    expect(filterByHost(rows, [])).toBe(rows);
    expect(filterByHost(rows, ["h2"])).toEqual([{ serverId: "h2" }]);
  });
});
