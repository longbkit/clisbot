import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { PermissionRequestCard } from "@/agent-stream/view";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { memo, useMemo, type ReactNode } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ActorResponseRow } from "@/clisbot/session-storage/actor-row";
import { AssistantMessage, Notification, ToolCall } from "@/components/message";
import type { StreamItem } from "@/types/stream";
import { botsCopy } from "../copy";
import { BotFace } from "./bot-face";
import type { ChatBotIdentity } from "./chat-rows";
import type { ChatRenderRow } from "./render-model";

/** The compact detail level of the cowork view: text streams, thoughts and tools fold. */
function renderLiveItem(
  item: StreamItem,
  serverId: string,
  isLast: boolean,
  bot: ChatBotIdentity,
  client: DaemonClient | null,
): ReactNode {
  switch (item.kind) {
    case "assistant_message":
      return (
        <AssistantMessage
          key={item.id}
          occurrenceKey={item.id}
          message={item.text}
          timestamp={item.timestamp.getTime()}
          serverId={serverId}
          phase="streaming"
          client={client}
          workspaceRoot={bot.cwd}
        />
      );
    case "thought":
      return (
        <ToolCall
          key={item.id}
          cwd={bot.cwd}
          toolName="thinking"
          args={item.text}
          status={item.status === "ready" ? "completed" : "executing"}
          isLastInSequence={isLast}
        />
      );
    case "tool_call":
      return item.payload.source === "agent" ? (
        <ToolCall
          key={item.id}
          cwd={bot.cwd}
          toolName={item.payload.data.name}
          error={item.payload.data.error}
          status={item.payload.data.status}
          detail={item.payload.data.detail}
          metadata={item.payload.data.metadata}
          isLastInSequence={isLast}
        />
      ) : (
        <ToolCall
          key={item.id}
          cwd={bot.cwd}
          toolName={item.payload.data.toolName}
          args={item.payload.data.arguments}
          result={item.payload.data.result}
          status={item.payload.data.status}
          isLastInSequence={isLast}
        />
      );
    case "notification":
      return <Notification key={item.id} level={item.level} message={item.message} />;
    default:
      return null;
  }
}

/** A bot's in-progress turn: live items and approvals under its face, pinned to its group. */
export const ChatLiveRow = memo(function ChatLiveRow({
  row,
  bot,
  serverId,
}: {
  row: Extract<ChatRenderRow, { kind: "live" }>;
  bot: ChatBotIdentity;
  serverId: string;
}) {
  const client = useHostRuntimeClient(serverId);
  const face = useMemo(
    () => <BotFace botId={bot.botId} name={bot.name} avatar={bot.avatar} />,
    [bot.avatar, bot.botId, bot.name],
  );
  const showWorking = row.inProgress && row.items.length === 0 && row.permissions.length === 0;
  return (
    <ActorResponseRow face={face} name={bot.name} opensGroup={row.opensGroup}>
      {row.items.map((item, index) =>
        renderLiveItem(item, serverId, index === row.items.length - 1, bot, client),
      )}
      {row.permissions.map((permission) => (
        <PermissionRequestCard
          key={permission.key}
          permission={permission}
          serverId={serverId}
          client={client}
        />
      ))}
      {showWorking ? (
        <Text style={styles.working} testID={`chat-live-working-${row.botId}`}>
          {botsCopy.working}
        </Text>
      ) : null}
    </ActorResponseRow>
  );
});

const styles = StyleSheet.create((theme) => ({
  working: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[2],
  },
}));
