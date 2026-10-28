import { describe, expect, it } from "vitest";
import registry from "../../e2e/registry.fixture.json";
import { browseMeta } from "./browse-meta";
import type { BrowseQuery } from "./links";
import type { Plugin } from "./registry";

const plugins = Array.from({ length: 85 }, (_, index) => ({
  ...registry.plugins[0],
  id: `owner/plugin-${index}`,
  categories: ["themes"],
  description: "shared-search-term",
})) as Plugin[];
const base: BrowseQuery = { sort: "installs", window: "week", page: 2 };
function meta(locale: "en" | "zh-CN", query: BrowseQuery = base) {
  return browseMeta({ title: "test", description: "test", locale, query, plugins });
}
function url(result: ReturnType<typeof meta>) {
  return result.links.find((link) => link.rel === "canonical")?.href;
}

describe("browse pagination metadata", () => {
  it("makes page 2 canonical and points every alternate at page 2", () => {
    for (const [locale, expected] of [
      ["en", "https://clisbot.com/plugins/all?page=2"],
      ["zh-CN", "https://clisbot.com/zh-CN/plugins/all?page=2"],
    ] as const) {
      const result = meta(locale);
      expect(url(result)).toBe(expected);
      expect(
        result.links.filter((link) => link.rel === "alternate").map((link) => link.href),
      ).toEqual([
        "https://clisbot.com/plugins/all?page=2",
        "https://clisbot.com/zh-CN/plugins/all?page=2",
        "https://clisbot.com/plugins/all?page=2",
      ]);
    }
  });
  it("clamps out-of-range pages to the content actually shown", () => {
    expect(url(meta("en", { ...base, page: 999 }))).toBe("https://clisbot.com/plugins/all?page=3");
  });
  it("keeps category and page in the canonical URL", () => {
    expect(url(meta("zh-CN", { ...base, category: "themes" }))).toBe(
      "https://clisbot.com/zh-CN/plugins/category/themes?page=2",
    );
  });
  it("preserves filtered search URL but prevents indexing it", () => {
    const result = meta("en", { ...base, q: "shared-search-term", sort: "new" });
    expect(url(result)).toBe(
      "https://clisbot.com/plugins/all?q=shared-search-term&page=2&sort=new",
    );
    expect(result.meta).toContainEqual({ name: "robots", content: "noindex, follow" });
    expect(result.links.filter((link) => link.rel === "alternate")).toHaveLength(0);
  });
});
