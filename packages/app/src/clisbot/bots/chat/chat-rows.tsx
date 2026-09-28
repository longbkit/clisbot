import { useChatMessageImages } from "./use-chat-message-images";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { memo, useMemo } from "react";
import { ActorResponseRow } from "@/clisbot/session-storage/actor-row";
import { AssistantMessage, Notification, UserMessage } from "@/components/message";
import { botsCopy } from "../copy";
import { BotFace } from "./bot-face";
import type { ChatRenderRow } from "./render-model";

/** What the chat needs to draw a participant; the screen builds it from the bot records. */
export interface ChatBotIdentity {
  botId: string;
  name: string;
  avatar?: string | null;
  cwd?: string;
  workspaceId?: string;
  agentId?: string;
  canConfigure?: boolean;
}

export function botIdentity(
  bots: ReadonlyMap<string, ChatBotIdentity>,
  botId: string,
): ChatBotIdentity {
  return bots.get(botId) ?? { botId, name: botsCopy.bot };
}

export const ChatUserRow = memo(function ChatUserRow({
  row,
  serverId,
  closesGroup,
}: {
  row: Extract<ChatRenderRow, { kind: "user" }>;
  serverId: string;
  closesGroup: boolean;
}) {
  const images = useChatMessageImages(serverId, row.line);
  return (
    <UserMessage
      serverId={serverId}
      messageId={row.line.id}
      message={row.line.text}
      images={images}
      attachments={row.line.attachments}
      timestamp={Date.parse(row.line.at)}
      isFirstInGroup={row.opensGroup}
      isLastInGroup={closesGroup}
      isConfirmed
    />
  );
});

/** A bot's final line: its face and name open the group, the text renders complete. */
export const ChatBotRow = memo(function ChatBotRow({
  row,
  bot,
  serverId,
}: {
  row: Extract<ChatRenderRow, { kind: "bot" }>;
  bot: ChatBotIdentity;
  serverId: string;
}) {
  const client = useHostRuntimeClient(serverId);
  const face = useMemo(
    () => <BotFace botId={bot.botId} name={bot.name} avatar={bot.avatar} />,
    [bot.avatar, bot.botId, bot.name],
  );
  return (
    <ActorResponseRow face={face} name={bot.name} opensGroup={row.opensGroup}>
      <AssistantMessage
        occurrenceKey={row.key}
        message={row.line.text}
        timestamp={Date.parse(row.line.at)}
        serverId={serverId}
        phase="complete"
        client={client}
        workspaceRoot={bot.cwd}
        underSenderName={row.opensGroup}
      />
    </ActorResponseRow>
  );
});

export const ChatSystemRow = memo(function ChatSystemRow({
  row,
}: {
  row: Extract<ChatRenderRow, { kind: "system" }>;
}) {
  return <Notification level="info" message={row.line.text} />;
});
