import { useSidebarPinMenu, useCreationActions } from "./use-section-actions";
import { PinOptionsMenu } from "./pin-options";
import { useBotSidebarActions } from "./use-sidebar-actions";
import { projectGroupSidebar, projectBotSidebar, selectedDirectBotKey } from "./sidebar-model";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { useGlobalSearchParams, usePathname } from "expo-router";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { useBotsFeatureHosts, useBotCreationHosts } from "../feature";
import { useBotCatalog } from "../data/runtime";
import { parseChatRouteFromPathname } from "../routes";
import { BotCreateForm } from "../create/bot-create-sheet";
import { GroupChatForm } from "../create/group-chat-form";
import { BotsSection } from "./bots-section";
import { ChatsSection } from "./chats-section";

const BOT_CREATE_SNAP_POINTS = ["95%"];
const BOT_CREATE_CONTENT_STYLE = { padding: 0 };

export function BotsAndChatsSidebarSections({
  onBeforeNavigate,
}: {
  onBeforeNavigate?: () => void;
}) {
  const hosts = useBotsFeatureHosts();
  return hosts.length ? <EnabledSections onBeforeNavigate={onBeforeNavigate} /> : null;
}
function EnabledSections({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const { hosts, bots, chats, botRows, chatRows, directoryHosts } = useSidebarCatalog();
  const directoryStatus = directoryLoadStatus(bots);
  const creationHosts = useBotCreationHosts();
  const defaultServerId = useDefaultCreationServerId(creationHosts);
  const { menu, pinned, onBotMenu, onChatMenu, closeMenu, actions, selectAction, ...menuState } =
    useSidebarPinMenu(onBeforeNavigate, chatRows);
  const { openBot, navigate, error } = useBotSidebarActions(
    chatRows,
    onBeforeNavigate,
    chats.loadState.status === "loaded",
  );
  const { openCreate, openGroup, onPressBot, ...creation } = useCreationActions(openBot, navigate);
  const current = parseChatRouteFromPathname(usePathname());
  const projectedBots = projectBotSidebar(botRows, chatRows, hosts.length > 1);
  const selectedBotKey = selectedDirectBotKey(chatRows, current);
  return (
    <View>
      {error || menuState.error || bots.error || chats.error ? (
        <Text accessibilityRole="alert">
          {error ?? menuState.error ?? bots.error?.message ?? chats.error?.message}
        </Text>
      ) : null}
      <ChatsSection
        botCount={botRows.length}
        chats={projectGroupSidebar(chatRows, hosts.length > 1).filter(
          (chat) => !pinned("chat", chat.serverId, chat.chatId),
        )}
        onOpenChatMenu={onChatMenu}
        onBeforeNavigate={onBeforeNavigate}
        onCreateChat={openGroup}
        canCreateChat={hosts.some(
          (host) => botRows.filter((bot) => bot.serverId === host.serverId).length >= 2,
        )}
      />
      <BotsSection
        directoryBots={projectedBots}
        directoryHosts={directoryHosts}
        loading={directoryStatus.loading}
        loadError={directoryStatus.error}
        onRetry={bots.refetch}
        bots={projectedBots.filter((bot) => !pinned("bot", bot.serverId, bot.botId))}
        selectedBotKey={selectedBotKey}
        onPressBot={onPressBot}
        onOpenBotMenu={onBotMenu}
        onCreateBot={openCreate}
        canCreateBot={creationHosts.length > 0}
      />
      <PinOptionsMenu
        anchor={menu?.anchor}
        visible={menu !== null}
        title={menu?.kind === "bot" ? "Bot" : "Group chat"}
        actions={actions}
        onSelect={selectAction}
        onClose={closeMenu}
      />
      <CreationSheets
        {...creation}
        defaultServerId={defaultServerId}
        hosts={hosts}
        creationHosts={creationHosts}
        botRows={botRows}
      />
    </View>
  );
}

/** The bot catalog as the sidebar reads it: loaded rows and the directory's Host list. */
function useSidebarCatalog() {
  const { hosts, bots, chats } = useBotCatalog();
  const directoryHosts = useMemo(
    () =>
      hosts.map((host) => ({
        serverId: host.serverId,
        serverName: host.label,
      })),
    [hosts],
  );
  const botRows = bots.loadState.status === "loaded" ? bots.loadState.data : [];
  const chatRows = useMemo(
    () => (chats.loadState.status === "loaded" ? chats.loadState.data : []),
    [chats.loadState],
  );
  return { hosts, bots, chats, botRows, chatRows, directoryHosts };
}

/** The route's Host when a bot can be created there, so the create form starts on it. */
function useDefaultCreationServerId(creationHosts: { serverId: string }[]): string | undefined {
  const params = useGlobalSearchParams<{ serverId?: string }>();
  return creationHosts.some((host) => host.serverId === params.serverId)
    ? params.serverId
    : undefined;
}

function CreationSheets({
  createName,
  groupOpen,
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
  closeCreate: () => void;
  closeGroup: () => void;
  defaultServerId?: string;
  hosts: { serverId: string; label: string }[];
  creationHosts: { serverId: string; label: string }[];
  botRows: Parameters<typeof GroupChatForm>[0]["bots"];
  onBotCreated: (serverId: string, botId: string) => void;
  onGroupCreated: (serverId: string, chatId: string) => void;
}) {
  const botHeader = useMemo(() => ({ title: "New bot" }), []);
  const groupHeader = useMemo(() => ({ title: "New group chat" }), []);
  return (
    <>
      <AdaptiveModalSheet
        scrollable={false}
        snapPoints={BOT_CREATE_SNAP_POINTS}
        contentStyle={BOT_CREATE_CONTENT_STYLE}
        visible={createName !== null}
        header={botHeader}
        onClose={closeCreate}
      >
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
      <AdaptiveModalSheet
        scrollable={false}
        snapPoints={BOT_CREATE_SNAP_POINTS}
        contentStyle={BOT_CREATE_CONTENT_STYLE}
        visible={groupOpen}
        header={groupHeader}
        onClose={closeGroup}
      >
        {groupOpen ? (
          <GroupChatForm bots={botRows} hosts={hosts} onCreated={onGroupCreated} />
        ) : null}
      </AdaptiveModalSheet>
    </>
  );
}

const partialFailureMessage = "Some Hosts could not load bots. Retry to refresh the complete list.";

function directoryLoadStatus(bots: ReturnType<typeof useBotCatalog>["bots"]) {
  return {
    loading: (bots.loadState.status !== "loaded" && !bots.error) || bots.isRefetching,
    error: bots.error?.message ?? (bots.hostErrors.length ? partialFailureMessage : null),
  };
}
