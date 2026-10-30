import { describe, expect, it } from "vitest";
import { splitPinTags, type PinTag, fitPinTags } from "./pin-tags-model";

const tags: PinTag[] = [
  { key: "bot:nia", title: "Nia", area: "chat", ownership: "mine" },
  { key: "ws:fix", title: "Fix Android image upload", area: "work", ownership: "mine" },
  { key: "ws:theirs", title: "Their release", area: "work", ownership: "others" },
  { key: "chat:theirs", title: "Their group", area: "chat", ownership: "others" },
  { key: "ws:untitled", title: "", area: "work", ownership: "mine" },
  { key: "ws:unplaced", title: "Nobody can tell", area: "work", ownership: "unknown" },
];
const keys = (list: PinTag[]) => list.map((tag) => tag.key);

describe("splitPinTags", () => {
  it("shows only my pins by default and folds others into one count", () => {
    const { mine, others } = splitPinTags(tags, "hybrid");
    // A pin nobody can place is the reader's: only a proven other person folds into the count.
    expect(keys(mine)).toEqual(["bot:nia", "ws:fix", "ws:unplaced"]);
    expect(keys(others)).toEqual(["ws:theirs", "chat:theirs"]);
  });

  it("follows Home's mode", () => {
    expect(keys(splitPinTags(tags, "chat").mine)).toEqual(["bot:nia"]);
    expect(keys(splitPinTags(tags, "work").mine)).toEqual(["ws:fix", "ws:unplaced"]);
    expect(keys(splitPinTags(tags, "work").others)).toEqual(["ws:theirs"]);
  });
});

const layout = { width: 300, gap: 8, moreWidth: 60 };

describe("fitPinTags", () => {
  it("shows every tag when they fit on two lines", () => {
    expect(fitPinTags([100, 100, 100, 100], layout)).toBe(4);
  });

  it("stops at two lines and keeps room for the +N tag on the second", () => {
    // Line 1: 100 + 100; line 2: 100 + 100 + the +N tag (60) = 276 of 300; the fifth would wrap.
    expect(fitPinTags([100, 100, 100, 100, 100], layout)).toBe(4);
    // Line 2: 100 + 130 leaves no room for +N, so the 130 gives way.
    expect(fitPinTags([100, 100, 100, 130, 100], layout)).toBe(3);
  });

  it("gives a tag wider than the line a line of its own", () => {
    expect(fitPinTags([400, 400, 400], layout)).toBe(1);
  });

  it("shows nothing but +N when not even one tag fits beside it", () => {
    expect(fitPinTags([400, 400, 400], { ...layout, lines: 1 })).toBe(0);
  });
});
