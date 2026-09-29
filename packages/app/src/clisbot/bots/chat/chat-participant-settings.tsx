import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import type { BotPayload } from "../data/contracts";
import { BotMembersField, type MemberBot } from "./bot-members-field";

/**
 * A group's members, with the same field as New group chat: the members listed, one search to
 * add more. Changes apply at once, one at a time; picks made while one runs wait their turn and
 * already show in the list. The last member cannot be removed.
 */
export function ChatParticipantSettings({
  chat,
  bots,
  disabled = false,
  toggle,
}: {
  chat: ChatPayload;
  bots: BotPayload[];
  disabled?: boolean;
  /** Flips one bot's membership; resolves once the chat has refetched. */
  toggle: (id: string) => Promise<void>;
}) {
  const { queued, enqueue } = useQueuedToggles(toggle);
  const { members, available } = useMemo(
    () => memberLists(chat, bots, queued),
    [chat, bots, queued],
  );
  const isLocked = useCallback(() => members.length === 1, [members.length]);
  return (
    <BotMembersField
      members={members}
      available={available}
      onAdd={enqueue}
      onRemove={enqueue}
      disabled={disabled}
      isLocked={isLocked}
    />
  );
}

/** Runs membership flips in order; the head of the queue is the one in flight. */
function useQueuedToggles(toggle: (id: string) => Promise<void>) {
  const [queued, setQueued] = useState<readonly string[]>([]);
  const running = useRef(false);
  const enqueue = useCallback(
    (id: string) => setQueued((current) => (current.includes(id) ? current : [...current, id])),
    [],
  );
  useEffect(() => {
    const next = queued[0];
    if (running.current || next === undefined) return;
    running.current = true;
    void toggle(next).finally(() => {
      running.current = false;
      setQueued((current) => current.slice(1));
    });
  }, [queued, toggle]);
  return { queued, enqueue };
}

/** Members in Members order, then the Host's bots not in the chat; queued flips already applied. */
function memberLists(
  chat: ChatPayload,
  bots: readonly BotPayload[],
  queued: readonly string[],
): { members: MemberBot[]; available: MemberBot[] } {
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const inChat = new Set(chat.participants.map((p) => p.botId));
  const isMember = (id: string) => inChat.has(id) !== queued.includes(id);
  const current = chat.participants.map(
    (p): MemberBot => byId.get(p.botId) ?? { id: p.botId, name: p.displayName },
  );
  const added = bots.filter((bot) => !inChat.has(bot.id) && isMember(bot.id));
  const members = [...current.filter((bot) => isMember(bot.id)), ...added];
  return { members, available: bots.filter((bot) => !isMember(bot.id)) };
}
