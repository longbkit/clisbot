import type { Href, router } from "expo-router";
import { resolvePhoneTabReturn, type PhoneTabReturn } from "./phone-tab-routes";

type TabRouter = Pick<typeof router, "navigate" | "replace" | "dismissTo">;

interface RootNavigation {
  getRootState(): Parameters<typeof resolvePhoneTabReturn>[0];
  dispatch(action: { type: "POP"; payload: { count: number }; target: string }): void;
}

interface TabNavigation {
  router: TabRouter;
  href: Href;
  nativeTab: boolean;
  /** Navigation V2 phones: the peer tabs are one retained navigator under the root stack. */
  phoneTabs?: RootNavigation | null;
}

/** Peer phone tabs must not accumulate hidden native stack pages and their directory demand. */
export function navigateHomeTab({ router, href, nativeTab, phoneTabs }: TabNavigation) {
  if (phoneTabs) {
    const route = resolvePhoneTab(phoneTabs);
    // Switch inside the tabs; from a detail, pop back onto them; a cold detail becomes the tabs.
    if (route.kind === "switch") router.navigate(href);
    else if (route.kind === "pop") router.dismissTo(href);
    else router.replace(href);
    return;
  }
  if (nativeTab) router.replace(href);
  else router.navigate(href);
}

/**
 * A phone detail's Back: pop the root stack to the retained tabs, which still show the tab the
 * detail opened from with its scroll position. With no tabs underneath, `fallback` replaces it.
 */
export function returnToPhoneTabs(navigation: RootNavigation, router: TabRouter, fallback: Href) {
  const route = resolvePhoneTab(navigation);
  if (route.kind === "pop")
    navigation.dispatch({ type: "POP", payload: { count: route.count }, target: route.target });
  else if (route.kind === "replace") router.replace(fallback);
}

function resolvePhoneTab(navigation: RootNavigation): PhoneTabReturn {
  return resolvePhoneTabReturn(navigation.getRootState());
}
