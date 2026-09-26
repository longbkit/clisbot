import { buildHostRootRoute } from "@/utils/host-routes";

/**
 * Paths of the Bots and Chats feature. Built on `buildHostRootRoute` so ids are encoded the way
 * every other host leaf encodes them; the naming pass renames a segment here and nowhere else
 * (docs/features/bots-and-chats/plans/app.md §2, O2).
 */
const CHAT_SEGMENT = "chat";
const BOT_SEGMENT = "bot";

function trimNonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildHostLeafRoute(serverId: string, segment: string, id: string): string {
  const base = buildHostRootRoute(serverId);
  const normalizedId = trimNonEmpty(id);
  if (base === "/" || !normalizedId) return "/";
  return `${base}/${segment}/${encodeURIComponent(normalizedId)}`;
}

export function buildHostChatRoute(serverId: string, chatId: string): string {
  return buildHostLeafRoute(serverId, CHAT_SEGMENT, chatId);
}

export function buildHostBotRoute(serverId: string, botId: string): string {
  return buildHostLeafRoute(serverId, BOT_SEGMENT, botId);
}

export interface ChatRouteMatch {
  serverId: string;
  chatId: string;
}

/** `/h/:serverId/chat/:chatId` (query and hash ignored), else null. */
export function parseChatRouteFromPathname(
  pathname: string | null | undefined,
): ChatRouteMatch | null {
  const path = trimNonEmpty(pathname)?.split(/[?#]/, 1)[0] ?? "";
  const match = new RegExp(`^/h/([^/]+)/${CHAT_SEGMENT}/([^/]+)/?$`).exec(path);
  if (!match) return null;
  return { serverId: decodeSegment(match[1]!), chatId: decodeSegment(match[2]!) };
}
