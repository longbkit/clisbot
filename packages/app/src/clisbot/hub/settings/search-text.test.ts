import { describe, expect, it } from "vitest";
import { foldSearchText, matchesSearch } from "./search-text";

describe("matchesSearch", () => {
  it("ignores case and Vietnamese diacritics", () => {
    expect(foldSearchText("Nguyễn Đức")).toBe("nguyen duc");
    expect(matchesSearch("nguyen duc", ["Nguyễn Đức Hậu"])).toBe(true);
  });
  it("needs every word, across any field", () => {
    expect(matchesSearch("hau vexere", ["Phan Đức Hậu", "duchau.phan@vexere.com"])).toBe(true);
    expect(matchesSearch("hau ota", ["Phan Đức Hậu", "duchau.phan@vexere.com"])).toBe(false);
  });
  it("matches everything for a blank query and skips missing fields", () => {
    expect(matchesSearch("  ", [])).toBe(true);
    expect(matchesSearch("x", [null, undefined])).toBe(false);
  });
});
