// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { router, navigateToLastWorkspace, platform } = vi.hoisted(() => ({
  platform: { isWeb: false },
  router: {
    canGoBack: vi.fn(() => true),
    back: vi.fn(),
    replace: vi.fn(),
    dismissTo: vi.fn(),
    push: vi.fn(),
  },
  navigateToLastWorkspace: vi.fn(() => true),
}));
vi.mock("expo-router", () => ({ router }));
vi.mock("@/constants/platform", () => platform);
vi.mock("@/clisbot/home/feature", () => ({ HOME_V2_ENABLED: true }));
vi.mock("@/stores/navigation-active-workspace-store", () => ({ navigateToLastWorkspace }));
import { returnAfterHostRemoval, returnFromSettings } from "./settings-navigation";

describe("Settings return navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.isWeb = false;
  });

  it("returns to its actual entry even when a previous workspace is saved", () => {
    returnFromSettings({ kind: "root" });
    expect(router.back).toHaveBeenCalledOnce();
    expect(navigateToLastWorkspace).not.toHaveBeenCalled();
  });

  it("uses the saved workspace for a cold Settings deep link without an entry", () => {
    router.canGoBack.mockReturnValueOnce(false);
    returnFromSettings({ kind: "root" });
    expect(navigateToLastWorkspace).toHaveBeenCalledOnce();
    expect(router.back).not.toHaveBeenCalled();
  });

  it("returns an app detail to the Settings list", () => {
    returnFromSettings({ kind: "section", section: "appearance" });
    expect(router.dismissTo).toHaveBeenCalledWith("/settings");
    expect(router.back).not.toHaveBeenCalled();
  });
  it("uses browser history after Forward restores Settings instead of a stale stack entry", () => {
    platform.isWeb = true;
    const length = vi.spyOn(window.history, "length", "get").mockReturnValue(3);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    returnFromSettings({ kind: "root" });
    expect(back).toHaveBeenCalledOnce();
    expect(router.back).not.toHaveBeenCalled();
    expect(navigateToLastWorkspace).not.toHaveBeenCalled();
    length.mockRestore();
    back.mockRestore();
  });
});

it("removing a compact Host detail leaves one Settings entry, so one Back reaches its reader", () => {
  platform.isWeb = true;
  const reader = "/h/removed/workspace/read";
  const history = [reader, "/settings", "/settings/hosts/removed/host"];
  router.replace.mockImplementationOnce((route) => {
    history[history.length - 1] = route;
  });
  router.dismissTo.mockImplementationOnce((route) => {
    const index = history.lastIndexOf(route);
    if (index >= 0) history.splice(index + 1);
    else history[history.length - 1] = route;
  });
  const length = vi.spyOn(window.history, "length", "get").mockReturnValue(3);
  const back = vi.spyOn(window.history, "back").mockImplementation(() => {
    history.pop();
  });
  try {
    returnAfterHostRemoval(true);
    expect(history.at(-1)).toBe("/settings");
    returnFromSettings({ kind: "root" });
    expect(history.at(-1)).toBe(reader);
  } finally {
    length.mockRestore();
    back.mockRestore();
    router.replace.mockReset();
    router.dismissTo.mockReset();
  }
});

it("removing a Host in wide Settings retains the General detail fallback", () => {
  returnAfterHostRemoval(false);
  expect(router.replace).toHaveBeenCalledWith("/settings/general");
});
