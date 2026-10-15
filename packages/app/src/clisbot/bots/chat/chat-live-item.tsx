import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { ReactNode } from "react";
import { AssistantMessage, Notification, ToolCall } from "@/components/message";
import type { StreamItem } from "@/types/stream";
import type { ChatBotIdentity } from "./chat-rows";
import { isHeartbeatRunNotification } from "@clisbot/protocol/schedule/heartbeat-notice";

/** The compact detail level of the cowork view: text streams, thoughts and tools fold. */
export function renderLiveItem(
  item: StreamItem,
  serverId: string,
  isLast: boolean,
  bot: ChatBotIdentity,
  client: DaemonClient | null,
  /** Tool details open in place, never in a sheet of their own (inside a menu sheet). */
  forceInline = false,
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
          forceInline={forceInline}
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
          forceInline={forceInline}
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
          forceInline={forceInline}
        />
      );
    case "notification":
      if (isHeartbeatRunNotification(item)) return null;
      return <Notification key={item.id} level={item.level} message={item.message} />;
    default:
      return null;
  }
}
