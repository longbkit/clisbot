import { parseChatRouteFromPathname } from "@/clisbot/bots/routes";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import { useRoutePath } from "./route-source";

/**
 * Route facts for always-mounted trees (docs/expo-router.md#route-reads). Each re-renders its
 * caller only when its own answer changes.
 */

function focusedChatKey(pathname: string): string | null {
  const chat = parseChatRouteFromPathname(pathname);
  return chat ? `${chat.serverId}:${chat.chatId}` : null;
}

function isWorkspacePath(pathname: string): boolean {
  return parseHostWorkspaceRouteFromPathname(pathname) !== null;
}

/** `serverId:chatId` of the chat route on screen, or null. */
export function useFocusedChatKey(): string | null {
  return useRoutePath(focusedChatKey);
}

export function useIsOnWorkspaceRoute(): boolean {
  return useRoutePath(isWorkspacePath);
}
