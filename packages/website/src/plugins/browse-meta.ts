import type { Locale } from "~/i18n";
import { pageMeta } from "~/meta";
import { browseHref, DEFAULT_WINDOW, PAGE_SIZE, type BrowseQuery } from "./links";
import { getPluginsInCategory, recentlyUpdated, searchPlugins, type Plugin } from "./registry";

/** Browse pages must identify their actual slice; filtered results are not indexed. */
export function browseMeta({
  title,
  description,
  query,
  plugins,
  locale,
}: {
  title: string;
  description: string;
  query: BrowseQuery;
  plugins: Plugin[];
  locale: Locale;
}) {
  let matches = query.sort === "updated" ? recentlyUpdated(plugins) : plugins;
  if (query.q) matches = searchPlugins(matches, query.q, locale);
  if (query.category) matches = getPluginsInCategory(matches, query.category);
  const page = Math.min(query.page ?? 1, Math.max(1, Math.ceil(matches.length / PAGE_SIZE)));
  const meta = pageMeta({ title, description, path: browseHref(query, page), locale });
  const filtered = Boolean(query.q) || query.sort !== "installs" || query.window !== DEFAULT_WINDOW;
  if (!filtered) return meta;
  return {
    meta: [...meta.meta, { name: "robots", content: "noindex, follow" }],
    links: meta.links.filter((link) => link.rel === "canonical"),
  };
}
