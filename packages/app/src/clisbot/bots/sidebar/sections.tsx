import { useBotSidebarActions } from "./use-sidebar-actions";
import { projectGroupSidebar, projectBotSidebar, selectedDirectBotKey } from "./sidebar-model";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useGlobalSearchParams, useRouter, usePathname } from "expo-router";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { useBotsFeatureHosts, useBotCreationHosts } from "../feature";
import { useBotCatalog } from "../data/runtime";
import { buildHostBotRoute, parseChatRouteFromPathname } from "../routes";
import { BotCreateForm } from "../create/bot-create-sheet";
import { GroupChatForm } from "../create/group-chat-form";
import { BotsSection } from "./bots-section";
import { ChatsSection } from "./chats-section";

export function BotsAndChatsSidebarSections({
  onBeforeNavigate,
}: {
  onBeforeNavigate?: () => void;
}) {
  const hosts = useBotsFeatureHosts();
  return hosts.length ? <EnabledSections onBeforeNavigate={onBeforeNavigate} /> : null;
}
function EnabledSections({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const { hosts, bots, chats } = useBotCatalog();
  const creationHosts = useBotCreationHosts();
  const router = useRouter();
  const params = useGlobalSearchParams<{ serverId?: string }>();
  const defaultServerId = creationHosts.some((host) => host.serverId === params.serverId)
    ? params.serverId
    : undefined;
  const [createName, setCreateName] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const botRows = bots.loadState.status === "loaded" ? bots.loadState.data : [];
  const chatRows = useMemo(
    () => (chats.loadState.status === "loaded" ? chats.loadState.data : []),
    [chats.loadState],
  );
  const { openBot, navigate, error } = useBotSidebarActions(
    chatRows,
    onBeforeNavigate,
    chats.loadState.status === "loaded",
  );
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
  const onBotMenu = useCallback(
    (bot: { serverId: string; botId: string }) => {
      onBeforeNavigate?.();
      router.push(buildHostBotRoute(bot.serverId, bot.botId));
    },
    [onBeforeNavigate, router],
  );
  const current = parseChatRouteFromPathname(usePathname());
  const projectedBots = projectBotSidebar(botRows, chatRows, hosts.length > 1);
  const selectedBotKey = selectedDirectBotKey(chatRows, current);
  const botHeader = useMemo(() => ({ title: "New bot" }), []);
  const groupHeader = useMemo(() => ({ title: "New group chat" }), []);
  return (
    <View>
      {error || bots.error || chats.error ? (
        <Text accessibilityRole="alert">
          {error ?? bots.error?.message ?? chats.error?.message}
        </Text>
      ) : null}
      <ChatsSection
        chats={projectGroupSidebar(chatRows, hosts.length > 1)}
        onBeforeNavigate={onBeforeNavigate}
        onCreateChat={openGroup}
        canCreateChat={hosts.some(
          (host) => botRows.filter((bot) => bot.serverId === host.serverId).length >= 2,
        )}
      />
      <BotsSection
        bots={projectedBots}
        selectedBotKey={selectedBotKey}
        onPressBot={onPressBot}
        onOpenBotMenu={onBotMenu}
        onCreateBot={openCreate}
        canCreateBot={creationHosts.length > 0}
      />
      <CreationSheets
        createName={createName}
        groupOpen={groupOpen}
        botHeader={botHeader}
        groupHeader={groupHeader}
        closeCreate={closeCreate}
        closeGroup={closeGroup}
        defaultServerId={defaultServerId}
        hosts={hosts}
        creationHosts={creationHosts}
        botRows={botRows}
        onBotCreated={onBotCreated}
        onGroupCreated={onGroupCreated}
      />
    </View>
  );
}

function CreationSheets({
  createName,
  groupOpen,
  botHeader,
  groupHeader,
  closeCreate,
  closeGroup,
  defaultServerId,
  hosts,
  creationHosts,
  botRows,
  onBotCreated,
  onGroupCreated,
}: {
  createName: string | null;
  groupOpen: boolean;
  botHeader: { title: string };
  groupHeader: { title: string };
  closeCreate: () => void;
  closeGroup: () => void;
  defaultServerId?: string;
  hosts: { serverId: string; label: string }[];
  creationHosts: { serverId: string; label: string }[];
  botRows: Parameters<typeof GroupChatForm>[0]["bots"];
  onBotCreated: (serverId: string, botId: string) => void;
  onGroupCreated: (serverId: string, chatId: string) => void;
}) {
  return (
    <>
      <AdaptiveModalSheet visible={createName !== null} header={botHeader} onClose={closeCreate}>
        {createName !== null ? (
          <BotCreateForm
            name={createName}
            defaultServerId={defaultServerId}
            hosts={creationHosts}
            onCancel={closeCreate}
            onCreated={onBotCreated}
          />
        ) : null}
      </AdaptiveModalSheet>
      <AdaptiveModalSheet visible={groupOpen} header={groupHeader} onClose={closeGroup}>
        {groupOpen ? (
          <GroupChatForm bots={botRows} hosts={hosts} onCreated={onGroupCreated} />
        ) : null}
      </AdaptiveModalSheet>
    </>
  );
}
