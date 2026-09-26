import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useGlobalSearchParams, useRouter } from "expo-router";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useBotsFeatureHosts } from "../feature";
import { useBotCatalog, refreshBotsAndChats } from "../data/runtime";
import { buildHostBotRoute, buildHostChatRoute } from "../routes";
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
  const router = useRouter();
  const params = useGlobalSearchParams<{ serverId?: string }>();
  const defaultServerId = hosts.some((host) => host.serverId === params.serverId)
    ? params.serverId
    : undefined;
  const [createName, setCreateName] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const botRows = bots.loadState.status === "loaded" ? bots.loadState.data : [];
  const chatRows = useMemo(
    () => (chats.loadState.status === "loaded" ? chats.loadState.data : []),
    [chats.loadState],
  );
  const navigate = useCallback(
    (serverId: string, chatId: string) => {
      onBeforeNavigate?.();
      router.push(buildHostChatRoute(serverId, chatId));
    },
    [onBeforeNavigate, router],
  );
  const openBot = useCallback(
    async (serverId: string, botId: string) => {
      if (opening) return;
      setOpening(true);
      setError(null);
      try {
        const existing = chatRows.find(
          (chat) =>
            chat.serverId === serverId &&
            chat.participants.length === 1 &&
            chat.participants[0]?.botId === botId,
        );
        if (existing) {
          navigate(serverId, existing.id);
          return;
        }
        const client = getHostRuntimeStore().getClient(serverId);
        if (!client) throw new Error("Host is disconnected");
        const result = await client.createChat({ botIds: [botId] });
        if (result.error || !result.chat) throw new Error(result.error ?? "Could not open chat");
        refreshBotsAndChats();
        navigate(serverId, result.chat.id);
      } catch (e) {
        setError(String(e));
      } finally {
        setOpening(false);
      }
    },
    [chatRows, navigate, opening],
  );
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
        chats={chatRows.map((chat) => ({
          key: `${chat.serverId}:${chat.id}`,
          serverId: chat.serverId,
          chatId: chat.id,
          title: chat.title,
          updatedAt: chat.updatedAt,
          hostLabel: hosts.length > 1 ? chat.serverName : null,
        }))}
        onBeforeNavigate={onBeforeNavigate}
      />
      <Button variant="ghost" onPress={openGroup}>
        New group chat
      </Button>
      <BotsSection
        bots={botRows.map((bot) => ({
          key: `${bot.serverId}:${bot.id}`,
          serverId: bot.serverId,
          botId: bot.id,
          name: bot.name,
          avatar: bot.avatar,
          hostLabel: hosts.length > 1 ? bot.serverName : null,
        }))}
        onPressBot={onPressBot}
        onOpenBotMenu={onBotMenu}
        onCreateBot={setCreateName}
      />
      <AdaptiveModalSheet visible={createName !== null} header={botHeader} onClose={closeCreate}>
        {createName !== null ? (
          <BotCreateForm
            name={createName}
            defaultServerId={defaultServerId}
            hosts={hosts}
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
    </View>
  );
}
