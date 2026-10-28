import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { getTranslator, routeLocale } from "~/i18n";
import { browseMeta } from "~/plugins/browse-meta";
import { getRegistry } from "~/plugins";
import { BrowsePage } from "~/plugins/browse-page";
import {
  type BrowseQuery,
  DEFAULT_WINDOW,
  parsePage,
  parseSearchTerm,
  parseSort,
  parseWindow,
} from "~/plugins/links";
import "~/styles.css";

export const Route = createFileRoute("/{-$locale}/plugins/all")({
  validateSearch: (search: Record<string, unknown>): Omit<Partial<BrowseQuery>, "category"> => ({
    sort: parseSort(search.sort),
    window: parseWindow(search.window),
    q: parseSearchTerm(search.q),
    page: parsePage(search.page),
  }),
  head: ({ params, match, loaderData }) => {
    const locale = routeLocale(params);
    const t = getTranslator(locale);
    return browseMeta({
      title: t("plugins.meta.allTitle"),
      description: t("plugins.meta.allDescription"),
      query: {
        sort: match.search.sort ?? "installs",
        window: match.search.window ?? DEFAULT_WINDOW,
        q: match.search.q,
        page: match.search.page,
      },
      plugins: loaderData?.plugins ?? [],
      locale,
    });
  },
  loader: () => getRegistry(),
  component: AllPluginsPage,
});

function AllPluginsPage() {
  const { plugins, installs, now } = Route.useLoaderData();
  const search = Route.useSearch();
  const query = useMemo<BrowseQuery>(
    () => ({
      sort: search.sort ?? "installs",
      window: search.window ?? DEFAULT_WINDOW,
      q: search.q,
      page: search.page,
    }),
    [search.sort, search.window, search.q, search.page],
  );
  return <BrowsePage plugins={plugins} installs={installs} now={now} query={query} />;
}
