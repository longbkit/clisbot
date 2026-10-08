import type { PinChat } from "./pin-identity";
import type { Rect } from "@/components/ui/anchor";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { buildHostBotRoute } from "../routes";
import { useResourcePins, type ResourcePin } from "./pins";
import { chatResourceActions, type ChatResourceActionId } from "../chat/chat-resource-actions";
import { useArchiveChat } from "../chat/use-archive-chat";
import { buildGroupSettingsRoute, buildMembersRoute } from "../chat/chat-panel-param";
import { useCreationRequest } from "./creation-request";
import { useCanConnectBotToChannel, useOpenConnectBotToChannel } from "../chat/use-connect-channel";
import type { BotFromProject } from "../create/bot-form-model";
export function useSidebarPinMenu(onBeforeNavigate?: () => void, chats?: readonly PinChat[]) {
  const router = useRouter();
  const { pins, toggle: togglePin, isPinned } = useResourcePins(chats);
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
  const pinned = (kind: ResourcePin["kind"], serverId: string, id: string) =>
    isPinned({ kind, serverId, id });
  const closeMenu = useCallback(() => setMenu(null), []);
  const archiveChat = useArchiveChat();
  const canConnectChannel = useCanConnectBotToChannel();
  const connectChannel = useOpenConnectBotToChannel();
  const [error, setError] = useState<string | null>(null);
  const actions = menu
    ? chatResourceActions({
        target: menu.kind === "bot" ? "bot" : "group",
        pinned: isPinned(menu),
        canConfigureBot: menu.canConfigure,
        canConnectChannel: menu.kind === "bot" && canConnectChannel(menu.serverId),
      })
    : [];
  const selectAction = useCallback(
    (id: ChatResourceActionId) => {
      if (!menu) return;
      closeMenu();
      setError(null);
      if (id === "pin") return togglePin(menu);
      if (id === "archive")
        return void archiveChat(menu.serverId, menu.id).catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : String(cause)),
        );
      onBeforeNavigate?.();
      if (id === "bot-settings") return router.push(buildHostBotRoute(menu.serverId, menu.id));
      if (id === "connect-channel") return connectChannel(menu.serverId, menu.id);
      if (id === "members") return router.push(buildMembersRoute(menu.serverId, menu.id));
      router.push(buildGroupSettingsRoute(menu.serverId, menu.id));
    },
    [menu, closeMenu, togglePin, archiveChat, onBeforeNavigate, router, connectChannel],
  );
  return { pins, menu, pinned, onBotMenu, onChatMenu, closeMenu, actions, selectAction, error };
}
export function useCreationActions(
  openBot: (serverId: string, botId: string) => unknown,
  navigate: (serverId: string, chatId: string) => void,
) {
  const [createName, setCreateName] = useState<string | null>(null);
  const [createProject, setCreateProject] = useState<BotFromProject | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const openCreateFrom = useCallback((project: BotFromProject | null) => {
    setCreateProject(project);
    setCreateName("");
  }, []);
  const openCreate = useCallback(() => openCreateFrom(null), [openCreateFrom]);
  const closeCreate = useCallback(() => setCreateName(null), []);
  const closeGroup = useCallback(() => setGroupOpen(false), []);
  const openGroup = useCallback(() => setGroupOpen(true), []);
  useCreationRequestHandler(openCreateFrom, openGroup);
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
    createProject,
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

/** Opens the sheet the Command Center asked for, then clears the request. */
function useCreationRequestHandler(
  openCreate: (project: BotFromProject | null) => void,
  openGroup: () => void,
) {
  const request = useCreationRequest((state) => state.request);
  const project = useCreationRequest((state) => state.project);
  const take = useCreationRequest((state) => state.take);
  const register = useCreationRequest((state) => state.register);
  useEffect(register, [register]);
  useEffect(() => {
    if (request === null) return;
    take();
    if (request === "bot") openCreate(project);
    else openGroup();
  }, [request, project, take, openCreate, openGroup]);
}
