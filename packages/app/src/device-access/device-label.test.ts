import { afterEach, expect, test, vi } from "vitest";
import { suggestedDeviceLabel } from "./device-label";
vi.mock("@/desktop/host", () => ({ getDesktopHost: () => null }));
vi.mock("expo-constants", () => ({ default: { deviceName: "Safari" } }));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
afterEach(() => vi.unstubAllGlobals());
test("Chrome is recognized before the Safari compatibility token and Expo's generic browser name", () => {
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36",
  });
  expect(suggestedDeviceLabel()).toBe("Chrome");
});
