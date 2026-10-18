import { MenuHeader } from "@/components/headers/menu-header";
import { profileNativeRegion } from "@/utils/render-profiler";
import { traceConversationPhase } from "@/performance/conversation-trace";
import { ChatToolsContext, useChatToolsValue } from "@/clisbot/connectors/chat-tools";
import { useSessionStore } from "@/stores/session-store";
import { useResourcePrincipalScope } from "../data/resource-principal-scope";
import { ConversationWorkspace } from "./conversation-workspace";
import { useChatVisibility } from "./use-chat-visibility";
import { acceptedChatRecord, useChatRecord } from "./use-chat-record";
import { useChatSend } from "./use-chat-send";
import { useIsCompactFormFactor } from "@/constants/layout";
import { scopedTranscriptKey } from "../data/session-scope";
import { useIsFocused } from "@react-navigation/native";
import { useChatLiveHeads } from "./use-chat-live-heads";
import { ChatOptions } from "./chat-options";
import { ChatHeartbeatsButton } from "@/clisbot/heartbeats/chat-heartbeats-button";
import { isGroupChat } from "./chat-kind";
import { ParticipantActions } from "./participant-actions";
import { StopAllAction } from "./stop-all-action";
import { useCallback, useLayoutEffect, useMemo, type ReactNode } from "react";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { View, Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { TimelineSyncStatus } from "@/timeline/sync-status";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { Theme } from "@/styles/theme";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import {
  useHostRuntimeClient,
  useHostRuntimeConnectionStatus,
  useHostRuntimeSnapshot,
} from "@/runtime/host-runtime";
import { useHostBotsFeature } from "../feature";
import { botsRuntime, useBotCatalog } from "../data/runtime";
import { useChatTranscriptQuery, type UseChatTranscriptResult } from "../data/use-chat-transcript";
import { ChatScreen } from "./chat-screen";
import { conversationToolDisplay } from "./tool-activity";
import { useChatToolActivityHeaderValue } from "./use-chat-tool-activity-header";
import { ChatToolActivityHeaderContext } from "./tool-activity-context";
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const loadingColor = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const keepSyncStatus = () => {};
const UPDATING = { status: "catching_up", ui: "status" } as const;
const RECONNECTING = { status: "reconnecting" } as const;
const EMPTY_PARTICIPANTS: ChatPayload["participants"] = [];

export default function ChatRoute() {
  return profileNativeRegion(
    "BotChatRoute",
    <HostRouteBootstrapBoundary>
      <Gate />
    </HostRouteBootstrapBoundary>,
  );
}
function Gate() {
  const { t } = useTranslation();
  const { serverId = "", chatId = "" } = useLocalSearchParams<{
    serverId: string;
    chatId: string;
  }>();
  const snapshot = useHostRuntimeSnapshot(serverId);
  const principalScope = useResourcePrincipalScope();
  const client = useHostRuntimeClient(serverId);
  const authFailure = snapshot?.authFailureReason || client?.authFailureReason;
  const enabled = useHostBotsFeature(serverId);
  const status = useHostRuntimeConnectionStatus(serverId);
  const unavailable =
    status === "online" ? t("bots.chat.route.notEnabled") : t("bots.chat.common.connectingToHost");
  if (!enabled || authFailure)
    return (
      <View style={styles.root}>
        <MenuHeader />
        <Text style={styles.loadingText} accessibilityRole={authFailure ? "alert" : undefined}>
          {authFailure ? (snapshot?.lastError ?? unavailable) : unavailable}
        </Text>
      </View>
    );
  return (
    <ChatRouteContent
      key={JSON.stringify([serverId, chatId, principalScope, snapshot?.clientGeneration ?? 0])}
      serverId={serverId}
      chatId={chatId}
    />
  );
}
function ChatRouteContent({ serverId, chatId }: { serverId: string; chatId: string }) {
  const { t } = useTranslation();
  const snapshot = useHostRuntimeSnapshot(serverId);
  const key = scopedTranscriptKey(serverId, chatId, snapshot);
  const principalScope = useResourcePrincipalScope();
  const focused = useIsFocused();
  const client = useHostRuntimeClient(serverId);
  const online = useHostRuntimeConnectionStatus(serverId) === "online";
  const catalog = useBotCatalog();
  const { chat, setChat, error, setError, authorized, transportInterrupted } = useChatRecord(
    client,
    online,
    chatId,
    key,
    acceptedChatRecord(catalog.chats, serverId, chatId),
  );
  const transcript = useChatTranscriptQuery({
    serverId,
    chatId,
    runtime: botsRuntime,
    presentationScope: principalScope,
    presentationAllowed: chat !== null,
  });
  useChatVisibility(serverId, chatId, chat, focused);
  const heads = useChatLiveHeads(serverId, chat?.participants ?? EMPTY_PARTICIPANTS);
  const { botRows, identities, workspaceByBotId } = useChatIdentities(
    serverId,
    chat?.participants,
    catalog.bots,
  );
  const attachmentsSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.bots === true,
  );
  const { send, sending } = useChatSend(
    client,
    online && authorized,
    chatId,
    chat,
    setChat,
    setError,
    attachmentsSupported,
    serverId,
  );
  const { loadOlder } = transcript;
  const reachTop = useCallback(() => {
    void loadOlder().catch((e) => setError(String(e)));
  }, [loadOlder, setError]);
  const group = chat ? isGroupChat(chat) : false;
  const working = group && [...heads.values()].some((head) => head.turnActive);
  // Clisbot Connectors: the Chat's own tools off list, for the composer's Tools chip.
  const chatTools = useChatToolsValue({
    serverId,
    chat,
    bots: identities,
    group,
    client,
  });
  const headingActions = useChatHeadingActions({
    chat,
    serverId,
    botRows,
    workspaceByBotId,
  });
  // Clisbot: a direct chat shows tool calls as its Bot says, a group as the group says.
  const directBot = !group ? botRows.find((b) => b.id === chat?.participants[0]?.botId) : undefined;
  const toolDisplay = conversationToolDisplay(chat, group, directBot);
  const toolActivityHeader = useChatToolActivityHeaderValue({
    enabled: toolDisplay === "header",
    serverId,
    group,
    heads,
    identities,
  });
  const options = useChatHeaderOptions({
    chat,
    chatId,
    serverId,
    workspaceByBotId,
    working,
    setError,
  });
  const messageCount = transcript.transcript.messages.length;
  const loadStatus = transcript.loadState.status;
  useLayoutEffect(() => {
    traceConversationPhase("body.commit", key, {
      metadata: String(chat !== null),
      rows: String(messageCount),
      load: loadStatus,
      focused: String(focused),
      error: String(Boolean(error) || loadStatus === "error"),
    });
  }, [key, chat, messageCount, loadStatus, focused, error]);
  const title = chat
    ? (chat.title ?? identities.map((b) => b.name).join(", "))
    : t("bots.chat.route.loading");
  return (
    <View style={styles.root}>
      <ChatToolsContext.Provider value={chatTools}>
        <ChatToolActivityHeaderContext.Provider value={toolActivityHeader}>
          {profileNativeRegion(
            "BotConversationWorkspace",
            <ConversationWorkspace
              group={group}
              serverId={serverId}
              chatId={chatId}
              accessScope={principalScope}
              title={title}
              bots={identities}
              headerActions={options}
              headingActions={headingActions}
            >
              <ChatRouteBody
                chat={chat}
                online={online}
                error={error}
                transcript={transcript}
                transportInterrupted={transportInterrupted}
              >
                {profileNativeRegion(
                  "BotChatScreen",
                  <ChatScreen
                    hideHeader
                    serverId={serverId}
                    chatId={chatId}
                    title={title}
                    bots={identities}
                    group={group}
                    transcript={transcript.transcript.messages}
                    liveHeads={heads}
                    discussionActive={chat?.discussionActive === true}
                    canSend={online && authorized && !sending}
                    onSubmitMessage={send}
                    onReachTop={reachTop}
                    toolDisplay={toolDisplay}
                  />,
                )}
              </ChatRouteBody>
            </ConversationWorkspace>,
          )}
        </ChatToolActivityHeaderContext.Provider>
      </ChatToolsContext.Provider>
    </View>
  );
}

/** Keep navigation and the accepted body mounted independently of refresh status. */
function ChatRouteBody({
  chat,
  online,
  error,
  transcript,
  transportInterrupted,
  children,
}: {
  chat: ChatPayload | null;
  online: boolean;
  error: string | null;
  transcript: UseChatTranscriptResult;
  transportInterrupted: boolean;
  children: ReactNode;
}) {
  const failure = transcript.loadState.status === "error" ? transcript.loadState : null;
  const blocked = failure && !failure.retainAccepted ? failure.message : null;
  if (!chat || blocked) return <ChatEmptyBody error={blocked ?? error} online={online} />;
  const visibleError = transportInterrupted ? null : error;
  const visibleFailure = failure?.retainAccepted ? null : failure;
  const initialLoading =
    transcript.loadState.status === "loading" && transcript.transcript.messages.length === 0;
  return (
    <View style={styles.body}>
      {visibleError || visibleFailure ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {visibleError ?? visibleFailure?.message}
        </Text>
      ) : null}
      {children}
      <ChatLoadingProgress
        initial={initialLoading}
        fetching={
          transcript.isFetching ||
          transcript.loadState.status === "loading" ||
          transportInterrupted ||
          Boolean(failure?.retainAccepted)
        }
        online={online}
      />
    </View>
  );
}

function ChatEmptyBody({ error, online }: { error: string | null; online: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={styles.body}>
      <View style={styles.centeredLoading} pointerEvents="none">
        {!error && online ? <ThemedLoadingSpinner size="large" uniProps={loadingColor} /> : null}
        <Text style={styles.loadingText} accessibilityRole={error ? "alert" : undefined}>
          {error ??
            (online ? t("bots.chat.route.loading") : t("bots.chat.common.connectingToHost"))}
        </Text>
      </View>
    </View>
  );
}

function ChatLoadingProgress({
  initial,
  fetching,
  online,
}: {
  initial: boolean;
  fetching: boolean;
  online: boolean;
}) {
  const { t } = useTranslation();
  if (!initial && !fetching && online) return null;
  if (!initial)
    return (
      <View testID="chat-refresh-loading" style={styles.syncStatus} pointerEvents="none">
        <TimelineSyncStatus
          sync={online ? UPDATING : RECONNECTING}
          toast={null}
          onDismiss={keepSyncStatus}
        />
      </View>
    );
  return (
    <View
      testID="chat-initial-loading"
      style={styles.centeredLoading}
      pointerEvents="none"
      accessibilityRole="progressbar"
      accessibilityLabel={t("bots.chat.route.loading")}
    >
      <ThemedLoadingSpinner size="large" uniProps={loadingColor} />
    </View>
  );
}

/** The chat's participants joined with this Host's bot rows: what the header and screen show. */
function useChatIdentities(
  serverId: string,
  participants: ChatPayload["participants"] | undefined,
  bots: ReturnType<typeof useBotCatalog>["bots"],
) {
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
  workspaceByBotId,
  working,
  setError,
}: {
  chat: ChatPayload | null;
  chatId: string;
  serverId: string;
  workspaceByBotId: ChatIdentities["workspaceByBotId"];
  working: boolean;
  setError: (value: string | null) => void;
}) {
  const compact = useIsCompactFormFactor();
  return useMemo(
    () =>
      chat ? (
        <View style={styles.actions}>
          <StopAllAction serverId={serverId} chatId={chatId} working={working} onError={setError} />
          {!compact ? (
            <ParticipantActions
              workspaceByBotId={workspaceByBotId}
              chatId={chatId}
              serverId={serverId}
              participants={chat.participants}
              group={isGroupChat(chat)}
            />
          ) : null}
        </View>
      ) : null,
    [chat, chatId, serverId, workspaceByBotId, working, setError, compact],
  );
}

/** The chat's ⋯ and Heartbeats, right after the heading as in the workspace header. */
function useChatHeadingActions({
  chat,
  serverId,
  botRows,
  workspaceByBotId,
}: {
  chat: ChatPayload | null;
  serverId: string;
  botRows: ChatIdentities["botRows"];
  workspaceByBotId: ChatIdentities["workspaceByBotId"];
}) {
  return useMemo(
    () =>
      chat ? (
        <>
          <ChatOptions
            serverId={serverId}
            chat={chat}
            bots={botRows}
            workspaceByBotId={workspaceByBotId}
          />
          <ChatHeartbeatsButton serverId={serverId} chat={chat} />
        </>
      ) : null,
    [botRows, chat, serverId, workspaceByBotId],
  );
}

type ChatIdentities = ReturnType<typeof useChatIdentities>;

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.surface0 },
  body: { flex: 1, minHeight: 0 },
  centeredLoading: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  loadingText: { color: theme.colors.foregroundMuted },
  syncStatus: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  error: { color: theme.colors.foreground, padding: theme.spacing[2] },
}));
