import { createElement, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import registry from "../../e2e/registry.fixture.json";
import { BrowsePage } from "./browse-page";
import { browseHref, parsePage, type BrowseQuery } from "./links";
import { selectAuthorRegistry, type Plugin } from "./registry";

vi.mock("~/i18n", () => ({
  useLocale: () => "en",
  useLocalizePath: () => (p: string) => p,
  formatNumber: (n: number) => String(n),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("lucide-react", () => ({ Download: () => null }));
vi.mock("./plugin-search", () => ({ PluginSearch: () => null }));
vi.mock("~/components/site-shell", () => ({
  SiteShell: ({ children }: PropsWithChildren) => createElement("main", null, children),
}));

const plugins = Array.from({ length: 85 }, (_, i) => ({
  ...registry.plugins[0],
  id: `owner/plugin-${String(i).padStart(3, "0")}`,
  name: `Plugin ${i}`,
  description: "shared-search-term",
  categories: ["themes"],
})) as Plugin[];
const base: BrowseQuery = { sort: "installs", window: "week" };
const installs = {};

async function render(query: BrowseQuery) {
  return renderToStaticMarkup(
    createElement(BrowsePage, { plugins, installs, now: "2026-10-28T00:00:00Z", query }),
  );
}

function ids(html: string) {
  return [...html.matchAll(/href="\/plugins\/(owner\/plugin-\d{3})"/g)].map((match) => match[1]);
}

describe("plugin browse pagination", () => {
  it("serves every result exactly once through stable page links", async () => {
    const pages = await Promise.all([
      render(base),
      render({ ...base, page: 2 }),
      render({ ...base, page: 3 }),
    ]);
    expect(pages.map((html) => ids(html).length)).toEqual([40, 40, 5]);
    expect(new Set(pages.flatMap(ids)).size).toBe(85);
    expect(pages[0]).toContain('href="/plugins/all?page=2"');
    expect(pages[1]).toContain('href="/plugins/all?page=3"');
    expect(pages[2]).toContain('href="/plugins/all?page=2"');
  });

  it("keeps search, sorting and category in links and clamps stale pages", async () => {
    const query: BrowseQuery = {
      category: "themes",
      q: "shared-search-term",
      sort: "new",
      window: "week",
      page: 2,
    };
    const html = await render(query);
    expect(ids(html)).toHaveLength(40);
    expect(html).toContain(
      'href="/plugins/category/themes?q=shared-search-term&amp;page=3&amp;sort=new"',
    );
    expect(ids(await render({ ...base, page: 999 }))).toHaveLength(5);
    expect(browseHref({ ...query, category: undefined })).toBe(
      "/plugins/all?q=shared-search-term&sort=new",
    );
  });

  it("rejects invalid page values", () => {
    for (const value of [
      undefined,
      null,
      0,
      -1,
      1,
      1.5,
      "NaN",
      "Infinity",
      "2.5",
      "9007199254740992",
    ])
      expect(parsePage(value)).toBeUndefined();
    expect(parsePage("2")).toBe(2);
  });
});

describe("author pages", () => {
  it("returns only the selected author's plugins and install counts", () => {
    const one = { ...plugins[0], id: "alice/one" };
    const two = { ...plugins[1], id: "alice/two" };
    const third = { ...plugins[2], id: "bob/three" };
    const counts = {
      "alice/one": { week: 2, month: 3, all: 4 },
      "bob/three": { week: 5, month: 6, all: 7 },
    };
    const result = selectAuthorRegistry([one, third, two], counts, "alice");
    expect(result.plugins.map((plugin) => plugin.id)).toEqual(["alice/one", "alice/two"]);
    expect(result.installs).toEqual({ "alice/one": { week: 2, month: 3, all: 4 } });
    expect(selectAuthorRegistry([one, third], counts, "missing")).toEqual({
      plugins: [],
      installs: {},
    });
  });
});
