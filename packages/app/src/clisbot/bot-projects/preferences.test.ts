import { beforeEach, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({
  getItem: vi.fn(async () => null),
  setItem: vi.fn(async () => {}),
  removeItem: vi.fn(async () => {}),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: storage }));
import { useBotProjectsPreference } from "./preferences";
beforeEach(() => {
  useBotProjectsPreference.setState({ showBotProjects: false });
  storage.setItem.mockClear();
});
it("defaults off and persists the same preference for both controls on this device", () => {
  expect(useBotProjectsPreference.getState().showBotProjects).toBe(false);
  useBotProjectsPreference.getState().toggleBotProjects();
  expect(useBotProjectsPreference.getState().showBotProjects).toBe(true);
  expect(storage.setItem).toHaveBeenCalledWith(
    "sidebar-bot-projects",
    expect.stringContaining('"showBotProjects":true'),
  );
  useBotProjectsPreference.getState().toggleBotProjects();
  expect(useBotProjectsPreference.getState().showBotProjects).toBe(false);
});

it("defaults the always-visible Bot projects section closed and persists expansion separately", () => {
  useBotProjectsPreference.setState({ botProjectsCollapsed: true });
  useBotProjectsPreference.getState().toggleBotProjectsCollapsed();
  expect(useBotProjectsPreference.getState().botProjectsCollapsed).toBe(false);
  expect(storage.setItem).toHaveBeenCalledWith(
    "sidebar-bot-projects",
    expect.stringContaining('"botProjectsCollapsed":false'),
  );
  useBotProjectsPreference.getState().toggleBotProjectsCollapsed();
  expect(useBotProjectsPreference.getState().botProjectsCollapsed).toBe(true);
});
