import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { BOT_ID_LABEL } from "@clisbot/protocol/bots/labels";
import type { ChatPayload } from "@/clisbot/bots/data/contracts";
import type { SelectFieldOption } from "@/components/ui/select-field";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { botsRuntime } from "@/clisbot/bots/data/runtime";
import { useChatsQuery } from "@/clisbot/bots/data/use-chats";
import { MultiSelectField, type MultiSelection } from "@/clisbot/hub/settings/multi-select-field";

/**
 * A heartbeat into a group Chat tags the Bots it is for, and only they answer; its own Bot
 * unless changed (docs/audits/2026-10-06-conversation-schedules.md). Direct Chats have one Bot.
 */
export interface ScheduleMentions {
  /** The group Chat's members, or none when the session is not in a group. */
  options: SelectFieldOption<string>[];
  value: string[];
  setValue: (value: string[]) => void;
}

export function useScheduleMentions(
  serverId: string | null,
  agentId: string | null,
  chatId: string | null,
): ScheduleMentions {
  const chat = useScheduleChat(serverId, chatId);
  const { agents } = useAggregatedAgents({ includeArchived: true });
  const ownBotId = agents.find((agent) => agent.id === agentId)?.labels?.[BOT_ID_LABEL] ?? null;
  const [chosen, setValue] = useState<{ agentId: string | null; value: string[] } | null>(null);
  const options = useMemo<SelectFieldOption<string>[]>(
    () =>
      chat && isGroup(chat)
        ? chat.participants.map((participant) => ({
            id: participant.botId,
            value: participant.botId,
            label: participant.displayName ?? participant.botId,
          }))
        : [],
    [chat],
  );
  // A new session starts over with its own Bot.
  const ownOnly = ownBotId ? [ownBotId] : [];
  const value = chosen && chosen.agentId === agentId ? chosen.value : ownOnly;
  const set = useCallback((next: string[]) => setValue({ agentId, value: next }), [agentId]);
  return { options, value, setValue: set };
}

function useScheduleChat(serverId: string | null, chatId: string | null): ChatPayload | null {
  const hosts = useMemo(
    () => (serverId && chatId ? [{ serverId, serverName: serverId }] : []),
    [chatId, serverId],
  );
  const chats = useChatsQuery({ hosts, runtime: botsRuntime });
  if (!chatId || chats.loadState.status !== "loaded") return null;
  return chats.loadState.data.find((chat) => chat.id === chatId) ?? null;
}

function isGroup(chat: ChatPayload): boolean {
  return chat.kind === "group" || chat.participants.length > 1;
}

export function ScheduleMentionsField({
  mentions,
}: {
  mentions: ScheduleMentions;
}): ReactElement | null {
  const { t } = useTranslation();
  const { setValue } = mentions;
  const handleChange = useCallback(
    (next: MultiSelection) => setValue(next === "*" ? [] : [...next]),
    [setValue],
  );
  if (mentions.options.length === 0) return null;
  return (
    <MultiSelectField
      label={t("heartbeats.mentions.label")}
      hint={t("heartbeats.mentions.hint")}
      options={mentions.options}
      value={mentions.value}
      onChange={handleChange}
      disabled={false}
      placeholder={t("heartbeats.mentions.placeholder")}
      searchPlaceholder={t("heartbeats.mentions.search")}
    />
  );
}
