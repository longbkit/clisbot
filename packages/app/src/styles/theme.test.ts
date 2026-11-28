import { describe, expect, it } from "vitest";
import {
  darkPureBlackTheme,
  darkTheme,
  FONT_SIZE,
  getNextThemePreference,
  lightTheme,
  THEME_OPTIONS,
} from "./theme";

describe("Typography scale", () => {
  it("names 14px as the default interface tier", () => {
    expect(FONT_SIZE).toEqual({
      code: 12,
      content: 15,
      sm: 12,
      base: 14,
      lg: 16,
      xl: 18,
      "2xl": 20,
      "3xl": 22,
      "4xl": 26,
    });
  });
});

describe("Theme catalog", () => {
  it("owns the picker and shortcut order", () => {
    expect(THEME_OPTIONS.map((option) => option.name)).toEqual([
      "light",
      "dark",
      "auto",
      "zinc",
      "midnight",
      "claude",
      "ghostty",
      "pureBlack",
    ]);
    expect(getNextThemePreference("dark")).toBe("auto");
    expect(getNextThemePreference("pureBlack")).toBe("light");
  });
});

describe("Pure black theme", () => {
  it("uses a pure black application and terminal background", () => {
    expect(darkPureBlackTheme.colors.surface0).toBe("#000000");
    expect(darkPureBlackTheme.colors.background).toBe("#000000");
    expect(darkPureBlackTheme.colors.terminal.background).toBe("#000000");
  });

  it("uses Clisbot's muted green accent", () => {
    expect(darkPureBlackTheme.colors.accent).toBe("#20744A");
    expect(darkPureBlackTheme.colors.accentBright).toBe("#7ccba0");
  });

  it("steps its sidebar hover and selection off the black sidebar", () => {
    expect(darkPureBlackTheme.colors.surfaceSidebar).toBe("#000000");
    expect(darkPureBlackTheme.colors.surfaceSidebarHover).toBe("#111111");
    expect(darkPureBlackTheme.colors.surfaceSidebarSelected).toBe("#1d1d1d");
  });

  it("keeps ANSI black output readable on its zero-luminance terminal background", () => {
    expect(darkPureBlackTheme.colors.terminal.black).toBe("#595959");
    expect(darkPureBlackTheme.colors.terminal.brightBlack).toBe("#8a8a8a");
  });
});

// Hover and selected are derived from the sidebar color. The values the default themes had when
// they were picked by eye are the reference: derivation lands within a few RGB units of them.
describe("Sidebar interaction surfaces", () => {
  function expectWithin(actual: string, expected: string, units: number) {
    const channels = (hex: string) =>
      [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
    const expectedChannels = channels(expected);
    channels(actual).forEach((channel, index) => {
      expect(Math.abs(channel - expectedChannels[index])).toBeLessThanOrEqual(units);
    });
  }

  // Clisbot's Light theme sets its own hover and selected values instead of the derived ones.
  it("keeps Light selection distinct from the sidebar surface", () => {
    expect(lightTheme.colors.surfaceSidebarHover).not.toBe(lightTheme.colors.surfaceSidebar);
    // The selected row is a white card on the gray sidebar, distinct from the gray hover.
    expect(lightTheme.colors.surfaceSidebarSelected).toBe(lightTheme.colors.surface0);
    expect(lightTheme.colors.surfaceSidebarSelected).not.toBe(lightTheme.colors.surfaceSidebar);
    expect(lightTheme.colors.surfaceSidebarSelected).not.toBe(
      lightTheme.colors.surfaceSidebarHover,
    );
  });

  it("keeps Dark hover and selection where they were", () => {
    expectWithin(darkTheme.colors.surfaceSidebarHover, "#1e2120", 2);
    expectWithin(darkTheme.colors.surfaceSidebarSelected, "#272a29", 2);
  });
});

describe("Placeholder text", () => {
  it("sits lighter than secondary text, so an empty field never reads as filled", () => {
    expect(lightTheme.colors.placeholder).toBe("#a1a1aa");
    expect(lightTheme.colors.placeholder).not.toBe(lightTheme.colors.foregroundMuted);
    expect(darkTheme.colors.placeholder).toBe(darkTheme.colors.foregroundExtraMuted);
  });
});

describe("Built-in light theme", () => {
  it("preserves its authored aliases and terminal contrast through the semantic builder", () => {
    expect(lightTheme.colors).toMatchObject({
      primary: "#18181b",
      primaryForeground: "#fafafa",
      destructiveForeground: "#ffffff",
      terminal: {
        black: "#1a1a1e",
        brightBlack: "#3f3f46",
      },
    });
  });
});
