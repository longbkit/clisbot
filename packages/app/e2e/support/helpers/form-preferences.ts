import type { Page } from "../fixtures";
import { getServerId } from "./server-id";

/** Device-wide preferences: launch target, isolation, and the seed each Host starts from. */
export const DEVICE_FORM_PREFERENCES_KEY = "@clisbot:create-agent-preferences";

/**
 * Provider, model, mode and thinking are remembered per Host (src/create-agent-preferences/
 * storage.ts); a Host's entry is seeded once from the device entry on its first read.
 */
export function hostFormPreferencesKey(serverId: string = getServerId()): string {
  return `${DEVICE_FORM_PREFERENCES_KEY}:host:${encodeURIComponent(serverId)}`;
}

export async function readHostFormPreferences(
  page: Page,
  serverId: string = getServerId(),
): Promise<Record<string, unknown> | null> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    hostFormPreferencesKey(serverId),
  );
}
