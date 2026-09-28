import { displayMentions, type MentionMember } from "./member-mentions";
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
  /** The `@slug` other messages use to name this bot. */
  slug?: string;
  avatar?: string | null;
  cwd?: string;
  workspaceId?: string;
  agentId?: string;
  canConfigure?: boolean;
}

const NO_MEMBERS: readonly MentionMember[] = [];

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
  members = NO_MEMBERS,
}: {
  row: Extract<ChatRenderRow, { kind: "user" }>;
  serverId: string;
  closesGroup: boolean;
  /** Participants, so `@slug` reads as the bot's name. */
  members?: readonly MentionMember[];
}) {
  const images = useChatMessageImages(serverId, row.line);
  const message = useMemo(
    () => displayMentions(row.line.text, members, { markdown: false }),
    [members, row.line.text],
  );
  return (
    <UserMessage
      serverId={serverId}
      messageId={row.line.id}
      message={message}
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
  members = NO_MEMBERS,
}: {
  row: Extract<ChatRenderRow, { kind: "bot" }>;
  bot: ChatBotIdentity;
  serverId: string;
  members?: readonly MentionMember[];
}) {
  const client = useHostRuntimeClient(serverId);
  const message = useMemo(
    () => displayMentions(row.line.text, members, { markdown: true }),
    [members, row.line.text],
  );
  const face = useMemo(
    () => <BotFace botId={bot.botId} name={bot.name} avatar={bot.avatar} />,
    [bot.avatar, bot.botId, bot.name],
  );
  return (
    <ActorResponseRow face={face} name={bot.name} opensGroup={row.opensGroup}>
      <AssistantMessage
        occurrenceKey={row.key}
        message={message}
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
