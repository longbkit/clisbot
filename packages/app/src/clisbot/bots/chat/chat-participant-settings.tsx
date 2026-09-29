import { useCallback, useMemo } from "react";
import type { ChatPayload } from "@getpaseo/protocol/chats/types";
import type { BotPayload } from "../data/contracts";
import { BotMembersField, type MemberBot } from "./bot-members-field";

/**
 * A group's members, with the same field as New group chat: the members listed, one search to
 * add more. Adding or removing applies at once; the last member cannot be removed.
 */
export function ChatParticipantSettings({
  chat,
  bots,
  busy,
  toggle,
}: {
  chat: ChatPayload;
  bots: BotPayload[];
  busy: boolean;
  toggle: (id: string) => Promise<void>;
}) {
  const { members, available } = useMemo(() => memberLists(chat, bots), [chat, bots]);
  const change = useCallback((id: string) => void toggle(id), [toggle]);
  const isLocked = useCallback(() => members.length === 1, [members.length]);
  return (
    <BotMembersField
      members={members}
      available={available}
      onAdd={change}
      onRemove={change}
      disabled={busy}
      isLocked={isLocked}
    />
  );
}

/** Members in Members order, then the Host's bots not in the chat. */
function memberLists(
  chat: ChatPayload,
  bots: readonly BotPayload[],
): { members: MemberBot[]; available: MemberBot[] } {
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const members = chat.participants.map(
    (p): MemberBot => byId.get(p.botId) ?? { id: p.botId, name: p.displayName },
  );
  const memberIds = new Set(members.map((bot) => bot.id));
  return { members, available: bots.filter((bot) => !memberIds.has(bot.id)) };
}
