import type { Href, Router } from "expo-router";

interface TabNavigation {
  router: Pick<Router, "navigate" | "replace" | "dismissTo">;
  href: Href;
  nativeTab: boolean;
}

/** Peer phone tabs must not accumulate hidden native stack pages and their directory demand. */
export function navigateHomeTab({ router, href, nativeTab }: TabNavigation) {
  if (nativeTab) router.replace(href);
  else router.navigate(href);
}

/** Return to the entry page when present; a cold deep link replaces its detail otherwise. */
export function returnToHomeTab({ router, href, nativeTab }: TabNavigation) {
  if (nativeTab) router.dismissTo(href);
  else router.navigate(href);
}
