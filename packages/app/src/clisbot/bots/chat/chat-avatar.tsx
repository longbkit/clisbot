import { BotFace } from "./bot-face";
import { GroupMark, type GroupMarkMember } from "./group-mark";

const NO_MEMBERS: readonly GroupMarkMember[] = [];

/**
 * The mark of a conversation: a direct chat is its Bot's face, a Group chat tiles its members'
 * faces (`GroupMark`). The sidebar row and the chat heading show one mark for one conversation.
 */
export function ChatAvatar({
  chatId,
  group,
  bot,
  members = NO_MEMBERS,
  size = 20,
}: {
  chatId: string;
  group: boolean;
  bot?: { botId: string; name: string; avatar?: string | null } | null;
  /** A Group chat's members, in Members order. */
  members?: readonly GroupMarkMember[];
  size?: number;
}) {
  if (!group && bot) {
    return <BotFace botId={bot.botId} name={bot.name} avatar={bot.avatar} size={size} />;
  }
  return <GroupMark chatId={chatId} members={members} size={size} />;
}
