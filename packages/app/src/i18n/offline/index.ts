import { i18n } from "@/i18n/i18next";
import { offlineResources } from "./resources";
import { offlineStorageResources } from "./storage-resources";

export const OFFLINE_NAMESPACE = "offline";

let registered = false;

function register(): void {
  if (registered) return;
  registered = true;
  for (const [language, resources] of Object.entries(offlineResources))
    i18n.addResourceBundle(language, OFFLINE_NAMESPACE, resources, true, false);
  for (const [language, resources] of Object.entries(offlineStorageResources))
    i18n.addResourceBundle(language, OFFLINE_NAMESPACE, resources, true, false);
}

/** Translate an `offline` namespace key in the current language, falling back to English. */
export function offlineT(key: string, options?: Record<string, unknown>): string {
  register();
  return i18n.t(key, { ...options, ns: OFFLINE_NAMESPACE });
}
