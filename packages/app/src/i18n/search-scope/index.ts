import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/i18next";
import { searchScopeResources } from "./resources";

export const SEARCH_SCOPE_NAMESPACE = "searchScope";

let registered = false;

function register(): void {
  if (registered) return;
  registered = true;
  for (const [language, resources] of Object.entries(searchScopeResources))
    i18n.addResourceBundle(language, SEARCH_SCOPE_NAMESPACE, resources, true, false);
}

/** `t` for `searchScope` keys in the current language, falling back to English. */
export function useSearchScopeTranslation() {
  register();
  return useTranslation(SEARCH_SCOPE_NAMESPACE);
}

/** The same outside React, for callbacks such as toast copy. */
export function searchScopeT(key: string, options?: Record<string, unknown>): string {
  register();
  return i18n.t(key, { ...options, ns: SEARCH_SCOPE_NAMESPACE });
}
