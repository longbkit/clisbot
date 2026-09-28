import type { Href } from "expo-router";
import { buildHostChatRoute } from "../routes";

/**
 * `?panel=group-settings` on a chat route opens its Group settings once the chat loads, so a
 * sidebar row's Group settings lands in the same sheet as the chat's own options menu.
 */
export const GROUP_SETTINGS_PANEL = "group-settings";

export function buildGroupSettingsRoute(serverId: string, chatId: string): Href & string {
  return `${buildHostChatRoute(serverId, chatId)}?panel=${GROUP_SETTINGS_PANEL}` as Href & string;
}
