import { ChatToolsContext, useChatToolsValue } from "@/clisbot/connectors/chat-tools";
import { useSessionStore } from "@/stores/session-store";
import { useResourcePrincipalScope } from "../data/resource-principal-scope";
import { ConversationWorkspace } from "./conversation-workspace";
import { useChatVisibility } from "./use-chat-visibility";
import { useChatRecord } from "./use-chat-record";
import { useChatSend } from "./use-chat-send";
import { botsSessionScope, scopedTranscriptKey } from "../data/session-scope";
import { useIsFocused } from "@react-navigation/native";
import { useChatLiveHeads } from "./use-chat-live-heads";
import { ChatOptions } from "./chat-options";
import { isGroupChat } from "./chat-kind";
import { ParticipantActions } from "./participant-actions";
import { StopAllAction } from "./stop-all-action";
import { useCallback, useMemo } from "react";
import { useLocalSearchParams } from "expo-router";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import {
  useHostRuntimeClient,
  useHostRuntimeConnectionStatus,
  useHostRuntimeSnapshot,
} from "@/runtime/host-runtime";
import { useHostBotsFeature } from "../feature";
import { botsRuntime, useBotCatalog } from "../data/runtime";
import { useChatTranscriptQuery } from "../data/use-chat-transcript";
import { ChatScreen } from "./chat-screen";
const EMPTY_PARTICIPANTS: ChatPayload["participants"] = [];

export default function ChatRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <Gate />
    </HostRouteBootstrapBoundary>
  );
}
function Gate() {
  const { serverId = "", chatId = "" } = useLocalSearchParams<{
    serverId: string;
    chatId: string;
  }>();
  const snapshot = useHostRuntimeSnapshot(serverId);
  const enabled = useHostBotsFeature(serverId);
  const status = useHostRuntimeConnectionStatus(serverId);
  if (!enabled)
    return (
      <Text>
        {status === "online"
          ? "Bots and Chats is not enabled on this Host."
          : "Connecting to Host…"}
      </Text>
    );
  return (
    <ChatRouteContent
      key={`${serverId}:${chatId}:${botsSessionScope(snapshot)}`}
      serverId={serverId}
      chatId={chatId}
    />
  );
}
function ChatRouteContent({ serverId, chatId }: { serverId: string; chatId: string }) {
  const snapshot = useHostRuntimeSnapshot(serverId);
  const key = scopedTranscriptKey(serverId, chatId, snapshot);
  const principalScope = useResourcePrincipalScope();
  const focused = useIsFocused();
  const client = useHostRuntimeClient(serverId);
  const online = useHostRuntimeConnectionStatus(serverId) === "online";
  const { chat, setChat, error, setError } = useChatRecord(client, online, chatId, key);
  const transcript = useChatTranscriptQuery({ serverId, chatId, runtime: botsRuntime });
  useChatVisibility(serverId, chatId, chat, focused);
  const heads = useChatLiveHeads(serverId, chat?.participants ?? EMPTY_PARTICIPANTS);
  const { botRows, identities, workspaceByBotId } = useChatIdentities(serverId, chat?.participants);
  const attachmentsSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.bots === true,
  );
  const { send, sending } = useChatSend(
    client,
    online,
    chatId,
    chat,
    setChat,
    setError,
    attachmentsSupported,
  );
  const { loadOlder } = transcript;
  const reachTop = useCallback(() => {
    void loadOlder().catch((e) => setError(String(e)));
  }, [loadOlder, setError]);
  const group = chat ? isGroupChat(chat) : false;
  const working = group && [...heads.values()].some((head) => head.turnActive);
  // Clisbot Connectors: the Chat's own tools off list, for the composer's Tools chip.
  const chatTools = useChatToolsValue({ serverId, chat, bots: identities, group, client });
  const options = useChatHeaderOptions({
    chat,
    chatId,
    serverId,
    botRows,
    workspaceByBotId,
    working,
    setError,
  });
  if (transcript.loadState.status === "error")
    return <Text accessibilityRole="alert">{transcript.loadState.message}</Text>;
  if (!chat) return <Text>{error ?? (online ? "Loading chat…" : "Connecting to Host…")}</Text>;
  const title = chat.title ?? identities.map((b) => b.name).join(", ");
  return (
    <View style={styles.root}>
      {!online ? <Text style={styles.error}>Host is offline. Your draft is saved.</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <ChatToolsContext.Provider value={chatTools}>
        <ConversationWorkspace
          group={group}
          serverId={serverId}
          chatId={chatId}
          accessScope={principalScope}
          title={title}
          bots={identities}
          headerActions={options}
        >
          <ChatScreen
            hideHeader
            serverId={serverId}
            chatId={chatId}
            title={title}
            bots={identities}
            group={group}
            transcript={transcript.transcript.messages}
            liveHeads={heads}
            canSend={online && !sending}
            onSubmitMessage={send}
            onReachTop={reachTop}
          />
        </ConversationWorkspace>
      </ChatToolsContext.Provider>
    </View>
  );
}

/** The chat's participants joined with this Host's bot rows: what the header and screen show. */
function useChatIdentities(
  serverId: string,
  participants: ChatPayload["participants"] | undefined,
) {
  const { bots } = useBotCatalog();
  const botRows = useMemo(
    () =>
      bots.loadState.status === "loaded"
        ? bots.loadState.data.filter((b) => b.serverId === serverId)
        : [],
    [bots.loadState, serverId],
  );
  const identities = useMemo(
    () =>
      (participants ?? []).map((p) => ({
        botId: p.botId,
        slug: p.slug,
        agentId: p.agentId ?? undefined,
        canConfigure: botRows.find((b) => b.id === p.botId)?.canConfigure,
        name: p.displayName,
        avatar: botRows.find((b) => b.id === p.botId)?.avatar,
        cwd: botRows.find((b) => b.id === p.botId)?.cwd,
        workspaceId: botRows.find((b) => b.id === p.botId)?.workspaceId,
      })),
    [participants, botRows],
  );
  const workspaceByBotId = useMemo(
    () =>
      new Map(
        identities.filter((bot) => bot.workspaceId).map((bot) => [bot.botId, bot.workspaceId!]),
      ),
    [identities],
  );
  return { botRows, identities, workspaceByBotId };
}

function useChatHeaderOptions({
  chat,
  chatId,
  serverId,
  botRows,
  workspaceByBotId,
  working,
  setError,
}: {
  chat: ChatPayload | null;
  chatId: string;
  serverId: string;
  botRows: ChatIdentities["botRows"];
  workspaceByBotId: ChatIdentities["workspaceByBotId"];
  working: boolean;
  setError: (value: string | null) => void;
}) {
  return useMemo(
    () =>
      chat ? (
        <View style={styles.actions}>
          <StopAllAction serverId={serverId} chatId={chatId} working={working} onError={setError} />
          <ParticipantActions
            workspaceByBotId={workspaceByBotId}
            chatId={chatId}
            serverId={serverId}
            participants={chat.participants}
            group={isGroupChat(chat)}
          />
          <ChatOptions serverId={serverId} chat={chat} bots={botRows} />
        </View>
      ) : null,
    [botRows, chat, chatId, serverId, workspaceByBotId, working, setError],
  );
}

type ChatIdentities = ReturnType<typeof useChatIdentities>;

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.surface0 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  error: { color: theme.colors.foreground, padding: theme.spacing[2] },
}));
