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
import { ParticipantActions } from "./participant-actions";
import { useCallback, useMemo } from "react";
import { useLocalSearchParams } from "expo-router";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ChatPayload } from "@getpaseo/protocol/chats/types";
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
  const { bots } = useBotCatalog();
  const { chat, setChat, error, setError } = useChatRecord(client, online, chatId, key);
  const transcript = useChatTranscriptQuery({ serverId, chatId, runtime: botsRuntime });
  useChatVisibility(serverId, chatId, chat, focused);
  const heads = useChatLiveHeads(serverId, chat?.participants ?? EMPTY_PARTICIPANTS);
  const botRows = useMemo(
    () =>
      bots.loadState.status === "loaded"
        ? bots.loadState.data.filter((b) => b.serverId === serverId)
        : [],
    [bots.loadState, serverId],
  );
  const identities = useMemo(
    () =>
      (chat?.participants ?? []).map((p) => ({
        botId: p.botId,
        agentId: p.agentId ?? undefined,
        canConfigure: botRows.find((b) => b.id === p.botId)?.canConfigure,
        name: p.displayName,
        avatar: botRows.find((b) => b.id === p.botId)?.avatar,
        cwd: botRows.find((b) => b.id === p.botId)?.cwd,
        workspaceId: botRows.find((b) => b.id === p.botId)?.workspaceId,
      })),
    [chat?.participants, botRows],
  );
  const workspaceByBotId = useMemo(
    () =>
      new Map(
        identities.filter((bot) => bot.workspaceId).map((bot) => [bot.botId, bot.workspaceId!]),
      ),
    [identities],
  );
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
  const options = useMemo(
    () =>
      chat ? (
        <View style={styles.actions}>
          <ParticipantActions
            workspaceByBotId={workspaceByBotId}
            chatId={chatId}
            serverId={serverId}
            participants={chat.participants}
            group={chat.kind === "group"}
          />
          <ChatOptions serverId={serverId} chat={chat} bots={botRows} />
        </View>
      ) : null,
    [botRows, chat, chatId, serverId, workspaceByBotId],
  );
  if (transcript.loadState.status === "error")
    return <Text accessibilityRole="alert">{transcript.loadState.message}</Text>;
  if (!chat) return <Text>{error ?? (online ? "Loading chat…" : "Connecting to Host…")}</Text>;
  return (
    <View style={styles.root}>
      {!online ? <Text style={styles.error}>Host is offline. Your draft is saved.</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <ConversationWorkspace
        group={chat.kind === "group" || (!chat.kind && chat.participants.length > 1)}
        serverId={serverId}
        chatId={chatId}
        accessScope={principalScope}
        title={chat.title ?? identities.map((b) => b.name).join(", ")}
        bots={identities}
        headerActions={options}
      >
        <ChatScreen
          hideHeader
          serverId={serverId}
          chatId={chatId}
          title={chat.title ?? identities.map((b) => b.name).join(", ")}
          bots={identities}
          transcript={transcript.transcript.messages}
          liveHeads={heads}
          canSend={online && !sending}
          onSubmitMessage={send}
          onReachTop={reachTop}
        />
      </ConversationWorkspace>
    </View>
  );
}
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
