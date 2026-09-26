import { useSessionStore, selectAgentTurnPresentation } from "@/stores/session-store";
import { memo, useCallback, useMemo } from "react";
import { View } from "react-native";
import { BotFace } from "../chat/bot-face";
import { botsCopy } from "../copy";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import { BotsSidebarRow } from "./row";
import { BotsSectionHeader } from "./section-header";

export interface BotsSidebarBot {
  /** `${serverId}:${botId}`, unique across hosts. */
  key: string;
  serverId: string;
  botId: string;
  name: string;
  avatar?: string | null;
  /** Shown under the name when more than one host has bots. */
  hostLabel?: string | null;
  /** The current user’s direct-chat session is running. */
  active?: boolean;
  updatedAt?: string;
  agentId?: string | null;
  canConfigure?: boolean;
}

interface BotsSectionProps {
  bots: readonly BotsSidebarBot[];
  selectedBotKey?: string | null;
  /** The Grok gesture: the row opens (or creates) the direct chat; the caller owns that. */
  onPressBot: (bot: BotsSidebarBot) => void;
  onOpenBotMenu?: (bot: BotsSidebarBot) => void;
  onCreateBot: () => void;
  canCreateBot?: boolean;
}

/** Each bot is its personal direct-chat entry; creation stays in the header. */
export const BotsSection = memo(function BotsSection({
  bots,
  selectedBotKey = null,
  onPressBot,
  onOpenBotMenu,
  onCreateBot,
  canCreateBot = true,
}: BotsSectionProps) {
  return (
    <View testID="sidebar-bots-section">
      <BotsSectionHeader
        label={botsCopy.bots}
        testID="sidebar-bots-header"
        createLabel={botsCopy.form.create}
        onCreate={onCreateBot}
        disabled={!canCreateBot}
      />
      {bots.map((bot) => (
        <BotRow
          key={bot.key}
          bot={bot}
          selected={bot.key === selectedBotKey}
          onPress={onPressBot}
          onOpenMenu={onOpenBotMenu}
        />
      ))}
    </View>
  );
});

const BotRow = memo(function BotRow({
  bot,
  selected,
  onPress,
  onOpenMenu,
}: {
  bot: BotsSidebarBot;
  selected: boolean;
  onPress: (bot: BotsSidebarBot) => void;
  onOpenMenu?: (bot: BotsSidebarBot) => void;
}) {
  const active = useSessionStore((state) =>
    bot.agentId
      ? selectAgentTurnPresentation(state.sessions[bot.serverId], bot.agentId).isActive
      : false,
  );
  const updatedAt = useMemo(
    () => (bot.updatedAt ? new Date(bot.updatedAt) : null),
    [bot.updatedAt],
  );
  const timeAgo = useCompactTimeAgo(updatedAt);
  const handlePress = useCallback(() => onPress(bot), [bot, onPress]);
  const handleOpenMenu = useCallback(() => onOpenMenu?.(bot), [bot, onOpenMenu]);
  const face = useMemo(
    () => <BotFace botId={bot.botId} name={bot.name} avatar={bot.avatar} />,
    [bot.avatar, bot.botId, bot.name],
  );
  return (
    <BotsSidebarRow
      leading={face}
      title={bot.name}
      subtitle={bot.hostLabel}
      active={bot.active ?? active}
      trailing={bot.updatedAt ? timeAgo : null}
      selected={selected}
      testID={`sidebar-bot-${bot.botId}`}
      onPress={handlePress}
      onOpenMenu={onOpenMenu && bot.canConfigure ? handleOpenMenu : undefined}
      menuLabel={botsCopy.botSettings}
    />
  );
});
