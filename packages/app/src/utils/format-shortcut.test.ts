import { describe, expect, it } from "vitest";

import { formatShortcut } from "./format-shortcut";

describe("formatShortcut", () => {
  it("uses symbols on macOS", () => {
    expect(formatShortcut(["mod", "B"], "mac")).toBe("⌘B");
    expect(formatShortcut(["mod", "E"], "mac")).toBe("⌘E");
  });

  it("uses the Shift symbol on macOS and spells it out elsewhere", () => {
    expect(formatShortcut(["shift", "Tab"], "mac")).toBe("⇧Tab");
    expect(formatShortcut(["mod", "shift", "P"], "mac")).toBe("⇧⌘P");
    expect(formatShortcut(["shift", "Tab"], "non-mac")).toBe("Shift+Tab");
  });

  it("uses Ctrl+ on non-mac platforms", () => {
    expect(formatShortcut(["mod", "B"], "non-mac")).toBe("Ctrl+B");
    expect(formatShortcut(["mod", "E"], "non-mac")).toBe("Ctrl+E");
  });

  it("spells Enter and Backspace in words mode", () => {
    expect(formatShortcut(["mod", "Enter"], "mac", "words")).toBe("⌘ Enter");
    expect(formatShortcut(["Backspace"], "mac", "words")).toBe("Backspace");
    expect(formatShortcut(["Up"], "mac", "words")).toBe("↑");
    expect(formatShortcut(["mod", "Enter"], "non-mac", "words")).toBe("Ctrl+Enter");
    expect(formatShortcut(["mod", "Enter"], "mac")).toBe("⌘⏎");
  });
});
