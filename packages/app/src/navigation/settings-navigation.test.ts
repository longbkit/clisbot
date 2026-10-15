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
import { returnFromSettings } from "./settings-navigation";

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
