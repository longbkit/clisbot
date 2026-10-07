import { describe, expect, it, vi } from "vitest";
import { configureMacOSLoginItem } from "./login-item";

describe("configureMacOSLoginItem", () => {
  it("enables the packaged app at macOS login", () => {
    const setLoginItemSettings = vi.fn();

    configureMacOSLoginItem({
      platform: "darwin",
      isPackaged: true,
      app: { setLoginItemSettings },
    });

    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
  });
  it("does not configure login startup for development or other platforms", () => {
    const setLoginItemSettings = vi.fn();

    configureMacOSLoginItem({
      platform: "darwin",
      isPackaged: false,
      app: { setLoginItemSettings },
    });
    configureMacOSLoginItem({
      platform: "linux",
      isPackaged: true,
      app: { setLoginItemSettings },
    });

    expect(setLoginItemSettings).not.toHaveBeenCalled();
  });
});
