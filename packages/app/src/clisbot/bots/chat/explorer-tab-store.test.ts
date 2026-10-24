import { describe, expect, it } from "vitest";
import { migratePanelState } from "@/stores/panel-store/state";
import {
  conversationExplorerStorage,
  createConversationExplorerTabs,
  conversationExplorerTab,
  useConversationExplorerTabs,
} from "./explorer-tab-store";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: async (name: string) => values.get(name) ?? null,
    setItem: async (name: string, value: string) => {
      values.set(name, value);
    },
    removeItem: async (name: string) => {
      values.delete(name);
    },
  };
}

describe("conversation explorer checkout tabs", () => {
  it("keeps Hosts and checkouts isolated and restores the prior selection", () => {
    useConversationExplorerTabs.setState({ tabs: {} });
    const first = { serverId: "first", cwd: "/repo", isGit: true };
    const second = { ...first, serverId: "second" };
    const other = { ...first, cwd: "/other" };
    const read = (checkout: typeof first) =>
      conversationExplorerTab(useConversationExplorerTabs.getState().tabs, checkout);
    expect(read(first)).toBe("changes");
    useConversationExplorerTabs.getState().setTab(first, "files");
    useConversationExplorerTabs.getState().setTab(second, "pr");
    expect(read(other)).toBe("changes");
    expect(read(second)).toBe("pr");
    expect(read(first)).toBe("files");
    expect(read({ ...other, isGit: false })).toBe("files");
  });

  it("transfers previous-install checkout preferences once without reseeding newer choices", async () => {
    const backing = memoryStorage({
      "panel-state": JSON.stringify({
        state: { explorerTabByCheckout: { "host::/repo": "pr" } },
        version: 16,
      }),
    });
    const storage = conversationExplorerStorage(backing);
    const first = await storage.getItem("conversation-explorer-tabs");
    expect(JSON.parse(first as string)).toEqual({
      state: { tabs: { "host::/repo": "pr" }, legacyImported: true },
      version: 1,
    });
    const updated = JSON.stringify({ state: { tabs: {}, legacyImported: true }, version: 1 });
    await storage.setItem("conversation-explorer-tabs", updated);
    expect(await storage.getItem("conversation-explorer-tabs")).toBe(updated);
  });

  it("retains validated old preferences when panel migration finishes before shell storage reads", async () => {
    const migratedPanel = migratePanelState(
      { explorerTabByCheckout: { "migrated-host::/repo": "files" } },
      16,
    );
    expect(migratedPanel.explorerTabByCheckout).toBeUndefined();
    const storage = conversationExplorerStorage(
      memoryStorage({ "panel-state": JSON.stringify({ state: migratedPanel, version: 17 }) }),
    );
    const value = JSON.parse((await storage.getItem("conversation-explorer-tabs")) as string);
    expect(value.state.tabs).toEqual({ "migrated-host::/repo": "files" });
    expect(value.state.legacyImported).toBe(true);
  });
});

it("keeps a user selection made during delayed legacy hydration in memory and on disk", async () => {
  const backing = memoryStorage({
    "panel-state": JSON.stringify({
      state: { explorerTabByCheckout: { "race-host::/repo": "pr" } },
      version: 16,
    }),
  });
  let releaseLegacy!: () => void;
  let reportLegacyRead!: () => void;
  const legacyGate = new Promise<void>((resolve) => {
    releaseLegacy = resolve;
  });
  const legacyReading = new Promise<void>((resolve) => {
    reportLegacyRead = resolve;
  });
  const store = createConversationExplorerTabs({
    ...backing,
    getItem: async (name) => {
      if (name === "panel-state") {
        reportLegacyRead();
        await legacyGate;
      }
      return backing.getItem(name);
    },
  });
  const hydrated = new Promise<void>((resolve) => store.persist.onFinishHydration(() => resolve()));
  await legacyReading;
  const checkout = { serverId: "race-host", cwd: "/repo", isGit: true };
  store.getState().setTab(checkout, "files");
  releaseLegacy();
  await hydrated;
  expect(conversationExplorerTab(store.getState().tabs, checkout)).toBe("files");
  const saved = JSON.parse(backing.values.get("conversation-explorer-tabs")!);
  expect(saved.state.tabs["race-host::/repo"]).toBe("files");
  expect(saved.state.legacyImported).toBe(true);
});
