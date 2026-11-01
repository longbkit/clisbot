import { describe, expect, it } from "vitest";
import { resolvePickerKey } from "./picker-keys";

const key = (
  value: string,
  mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {},
) => ({
  key: value,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("picker keys", () => {
  it("picks the Nth row with ⌘N on a Mac and Ctrl+N elsewhere", () => {
    expect(resolvePickerKey(key("3", { metaKey: true }), "mac")).toEqual({
      kind: "pick",
      index: 2,
    });
    expect(resolvePickerKey(key("1", { ctrlKey: true }), "non-mac")).toEqual({
      kind: "pick",
      index: 0,
    });
    expect(resolvePickerKey(key("1", { ctrlKey: true }), "mac")).toBeNull();
    expect(resolvePickerKey(key("0", { metaKey: true }), "mac")).toBeNull();
  });

  it("moves with the arrows and picks with Enter", () => {
    expect(resolvePickerKey(key("ArrowDown"), "mac")).toEqual({ kind: "move", key: "ArrowDown" });
    expect(resolvePickerKey(key("ArrowUp"), "mac")).toEqual({ kind: "move", key: "ArrowUp" });
    expect(resolvePickerKey(key("Enter"), "mac")).toEqual({ kind: "enter" });
    expect(resolvePickerKey(key("Enter", { shiftKey: true }), "mac")).toBeNull();
    expect(resolvePickerKey(key("a"), "mac")).toBeNull();
  });
});
