import type { Href } from "expo-router";
import { buildHostChatRoute } from "../routes";

/**
 * `?panel=group-settings` (or `members`) on a chat route opens that sheet once the chat loads, so
 * a sidebar row's Group settings and Members land in the same sheets as the chat's options menu.
 */
export const GROUP_SETTINGS_PANEL = "group-settings";
export const MEMBERS_PANEL = "members";

export function buildGroupSettingsRoute(serverId: string, chatId: string): Href & string {
  return `${buildHostChatRoute(serverId, chatId)}?panel=${GROUP_SETTINGS_PANEL}` as Href & string;
}

export function buildMembersRoute(serverId: string, chatId: string): Href & string {
  return `${buildHostChatRoute(serverId, chatId)}?panel=${MEMBERS_PANEL}` as Href & string;
}
