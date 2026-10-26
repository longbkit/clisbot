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

  it("opens Home on All, and moves a stored Home scope to All once (v1 → v2)", () => {
    expect(useNavigationStore.getState().scopes.home).toBe("all");
    const migrate = useNavigationStore.persist.getOptions().migrate!;
    const migrated = migrate(
      { scopes: { home: "mine", chats: "others", work: "mine" }, workShowBots: false },
      1,
    ) as Record<string, unknown>;
    // The reader's other choices stay, the Bots chip included.
    expect(migrated).toMatchObject({
      scopes: { home: "all", chats: "others", work: "mine" },
      workShowBots: false,
    });
  });

  it("persists the Bots chip", () => {
    const partialize = useNavigationStore.persist.getOptions().partialize!;
    expect(partialize(useNavigationStore.getState())).toHaveProperty("workShowBots", true);
  });
});
