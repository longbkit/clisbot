import { beforeEach, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({
  getItem: vi.fn(async (): Promise<string | null> => null),
  setItem: vi.fn(async () => {}),
  removeItem: vi.fn(async () => {}),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: storage,
}));
import { useBotProjectsPreference } from "./preferences";
beforeEach(() => {
  useBotProjectsPreference.setState({ showBotProjects: true });
  storage.setItem.mockClear();
});
it("defaults visible and remembers the Projects display preference on this device", () => {
  expect(useBotProjectsPreference.getInitialState().showBotProjects).toBe(true);
  expect(useBotProjectsPreference.getState().showBotProjects).toBe(true);
  useBotProjectsPreference.getState().toggleBotProjects();
  expect(storage.setItem).toHaveBeenCalledWith(
    "sidebar-bot-projects",
    expect.stringContaining('"showBotProjects":false'),
  );
  useBotProjectsPreference.getState().toggleBotProjects();
  expect(useBotProjectsPreference.getState().showBotProjects).toBe(true);
});

it("shows merged Bot projects when upgrading the former collapsed section", async () => {
  storage.getItem.mockResolvedValueOnce(
    JSON.stringify({
      state: { showBotProjects: false, botProjectsCollapsed: true },
      version: 0,
    }),
  );
  await useBotProjectsPreference.persist.rehydrate();
  expect(useBotProjectsPreference.getState().showBotProjects).toBe(true);
});

it("restores an explicit hidden preference after the upgrade", async () => {
  storage.getItem.mockResolvedValueOnce(
    JSON.stringify({
      state: { showBotProjects: false },
      version: 1,
    }),
  );
  await useBotProjectsPreference.persist.rehydrate();
  expect(useBotProjectsPreference.getState().showBotProjects).toBe(false);
});
