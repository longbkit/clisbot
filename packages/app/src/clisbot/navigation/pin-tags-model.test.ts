import { describe, expect, it } from "vitest";
import { splitPinTags, type PinTag } from "./pin-tags-model";

const tags: PinTag[] = [
  { key: "bot:nia", title: "Nia", area: "chat", ownership: "mine" },
  { key: "ws:fix", title: "Fix Android image upload", area: "work", ownership: "mine" },
  { key: "ws:theirs", title: "Their release", area: "work", ownership: "others" },
  { key: "chat:theirs", title: "Their group", area: "chat", ownership: "others" },
  { key: "ws:untitled", title: "", area: "work", ownership: "mine" },
];
const keys = (list: PinTag[]) => list.map((tag) => tag.key);

describe("splitPinTags", () => {
  it("shows only my pins by default and folds others into one count", () => {
    const { mine, others } = splitPinTags(tags, "hybrid");
    expect(keys(mine)).toEqual(["bot:nia", "ws:fix"]);
    expect(keys(others)).toEqual(["ws:theirs", "chat:theirs"]);
  });

  it("follows Home's mode", () => {
    expect(keys(splitPinTags(tags, "chat").mine)).toEqual(["bot:nia"]);
    expect(keys(splitPinTags(tags, "work").others)).toEqual(["ws:theirs"]);
  });
});
