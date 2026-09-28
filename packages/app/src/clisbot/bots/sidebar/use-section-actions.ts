import type { Rect } from "@/components/ui/menu/menu-anchor";
import { useCallback, useState } from "react";
import { useRouter } from "expo-router";
import { buildHostBotRoute } from "../routes";
import { useResourcePins, pinKey, type ResourcePin } from "./pins";
export function useSidebarPinMenu(onBeforeNavigate?: () => void) {
  const router = useRouter();
  const { pins, toggle: togglePin } = useResourcePins();
  const [menu, setMenu] = useState<(ResourcePin & { canConfigure?: boolean; anchor: Rect }) | null>(
    null,
  );
  const onBotMenu = useCallback(
    (bot: { serverId: string; botId: string; canConfigure?: boolean }, anchor: Rect) =>
      setMenu({
        anchor,
        kind: "bot",
        serverId: bot.serverId,
        id: bot.botId,
        canConfigure: bot.canConfigure,
      }),
    [],
  );
  const onChatMenu = useCallback(
    (chat: { serverId: string; chatId: string }, anchor: Rect) =>
      setMenu({ anchor, kind: "chat", serverId: chat.serverId, id: chat.chatId }),
    [],
  );
  const pinned = (kind: "bot" | "chat", serverId: string, id: string) =>
    pins.some((pin) => pinKey(pin) === pinKey({ kind, serverId, id }));
  const closeMenu = useCallback(() => setMenu(null), []);
  const toggleMenuPin = useCallback(() => {
    if (menu) togglePin(menu);
    closeMenu();
  }, [menu, togglePin, closeMenu]);
  const configureMenuBot = useCallback(() => {
    if (!menu || menu.kind !== "bot" || !menu.canConfigure) return;
    closeMenu();
    onBeforeNavigate?.();
    router.push(buildHostBotRoute(menu.serverId, menu.id));
  }, [menu, closeMenu, onBeforeNavigate, router]);
  return { pins, menu, pinned, onBotMenu, onChatMenu, closeMenu, toggleMenuPin, configureMenuBot };
}
export function useCreationActions(
  openBot: (serverId: string, botId: string) => unknown,
  navigate: (serverId: string, chatId: string) => void,
) {
  const [createName, setCreateName] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const openCreate = useCallback(() => setCreateName(""), []);
  const closeCreate = useCallback(() => setCreateName(null), []);
  const closeGroup = useCallback(() => setGroupOpen(false), []);
  const openGroup = useCallback(() => setGroupOpen(true), []);
  const onBotCreated = useCallback(
    (serverId: string, botId: string) => {
      setCreateName(null);
      void openBot(serverId, botId);
    },
    [openBot],
  );
  const onGroupCreated = useCallback(
    (serverId: string, chatId: string) => {
      setGroupOpen(false);
      navigate(serverId, chatId);
    },
    [navigate],
  );
  const onPressBot = useCallback(
    (bot: { serverId: string; botId: string }) => {
      void openBot(bot.serverId, bot.botId);
    },
    [openBot],
  );
  return {
    createName,
    groupOpen,
    openCreate,
    closeCreate,
    closeGroup,
    openGroup,
    onBotCreated,
    onGroupCreated,
    onPressBot,
  };
}
