import { afterEach, expect, test, vi } from "vitest";
import { suggestedDeviceLabel } from "./device-label";
vi.mock("@/desktop/host", () => ({ getDesktopHost: () => null }));
vi.mock("expo-constants", () => ({ default: { deviceName: "Safari" } }));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
afterEach(() => vi.unstubAllGlobals());

function stubBrowser(userAgent: string, stored: Record<string, string> = {}) {
  vi.stubGlobal("navigator", { userAgent });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => {
      stored[key] = value;
    },
  });
  return stored;
}

test("names the browser and system before the Safari compatibility token and Expo's generic browser name", () => {
  stubBrowser(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36",
  );
  expect(suggestedDeviceLabel()).toMatch(/^Clisbot · Chrome on macOS · [a-z0-9]{4}$/);
});

test("keeps the same random tag across pairings in one browser", () => {
  const stored = stubBrowser("Mozilla/5.0 (Windows NT 10.0) Firefox/130.0", {
    "clisbot.device-label-suffix": "k7f2",
  });
  expect(suggestedDeviceLabel()).toBe("Clisbot · Firefox on Windows · k7f2");
  expect(suggestedDeviceLabel()).toBe("Clisbot · Firefox on Windows · k7f2");
  expect(stored["clisbot.device-label-suffix"]).toBe("k7f2");
});
