import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn() },
}));

const { useNavigationStore } = await import("./store");

describe("Navigation V2 preferences", () => {
  it("lists Bot sessions in the Workspace list by default and toggles them with the Bots chip", () => {
    expect(useNavigationStore.getState().workShowBots).toBe(true);
    useNavigationStore.getState().toggleWorkShowBots();
    expect(useNavigationStore.getState().workShowBots).toBe(false);
    useNavigationStore.getState().toggleWorkShowBots();
  });

  it("drops the old Bot projects switch and starts the Bots chip on (v0 → v1)", () => {
    const migrate = useNavigationStore.persist.getOptions().migrate!;
    const migrated = migrate(
      { homeMode: "work", showBotProjectsInWork: false, chatsSplit: true },
      0,
    ) as Record<string, unknown>;
    expect(migrated).not.toHaveProperty("showBotProjectsInWork");
    expect(migrated).toMatchObject({ homeMode: "work", chatsSplit: true, workShowBots: true });
  });

  it("opens every list on For me, and a stored Home scope ends on For me (v1 → v4)", () => {
    expect(useNavigationStore.getState().scopes).toEqual({
      home: "mine",
      chats: "mine",
      work: "mine",
    });
    const migrate = useNavigationStore.persist.getOptions().migrate!;
    const migrated = migrate(
      { scopes: { home: "mine", chats: "others", work: "mine" }, workShowBots: false },
      1,
    ) as Record<string, unknown>;
    // The reader's other choices stay, the Bots chip included.
    expect(migrated).toMatchObject({
      scopes: { home: "mine", chats: "others", work: "mine" },
      workShowBots: false,
    });
  });

  it("drops Chats' own Host filter for the app-wide one, and keeps a v2 Home scope (v2 → v3)", () => {
    const migrate = useNavigationStore.persist.getOptions().migrate!;
    const migrated = migrate(
      { scopes: { home: "mine", chats: "mine", work: "mine" }, chatsHosts: ["a"] },
      2,
    ) as Record<string, unknown>;
    expect(migrated).not.toHaveProperty("chatsHosts");
    expect(migrated.scopes).toMatchObject({ home: "mine" });
  });

  it("returns a Home scope that v2 forced to All to For me once, then keeps the choice (v3 → v4)", () => {
    const migrate = useNavigationStore.persist.getOptions().migrate!;
    const stored = { scopes: { home: "all", chats: "others", work: "all" } };
    expect(migrate(stored, 3)).toMatchObject({
      scopes: { home: "mine", chats: "others", work: "all" },
    });
    expect(migrate(stored, 4)).toMatchObject({ scopes: stored.scopes });
  });

  it("persists the Bots chip", () => {
    const partialize = useNavigationStore.persist.getOptions().partialize!;
    expect(partialize(useNavigationStore.getState())).toHaveProperty("workShowBots", true);
  });
});
