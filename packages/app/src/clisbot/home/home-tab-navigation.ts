import type { Href, router } from "expo-router";

interface TabNavigation {
  router: Pick<typeof router, "navigate" | "replace">;
  href: Href;
  nativeTab: boolean;
}

/** Peer phone tabs must not accumulate hidden native stack pages and their directory demand. */
export function navigateHomeTab({ router, href, nativeTab }: TabNavigation) {
  if (nativeTab) router.replace(href);
  else router.navigate(href);
}
