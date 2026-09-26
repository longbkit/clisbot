import { memo, useCallback, useMemo } from "react";
import { View } from "react-native";
import { BotFace } from "../chat/bot-face";
import { botsCopy } from "../copy";
import { NewBotRow } from "./new-bot-row";
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
  /** A session of the bot is running somewhere. */
  active?: boolean;
}

interface BotsSectionProps {
  bots: readonly BotsSidebarBot[];
  selectedBotKey?: string | null;
  /** The Grok gesture: the row opens (or creates) the direct chat; the caller owns that. */
  onPressBot: (bot: BotsSidebarBot) => void;
  onOpenBotMenu?: (bot: BotsSidebarBot) => void;
  onCreateBot: (name: string) => void;
}

/** The Bots section: one row per bot and the create-by-name row (plans/app.md §1). */
export const BotsSection = memo(function BotsSection({
  bots,
  selectedBotKey = null,
  onPressBot,
  onOpenBotMenu,
  onCreateBot,
}: BotsSectionProps) {
  return (
    <View testID="sidebar-bots-section">
      <BotsSectionHeader label={botsCopy.bots} testID="sidebar-bots-header" />
      {bots.map((bot) => (
        <BotRow
          key={bot.key}
          bot={bot}
          selected={bot.key === selectedBotKey}
          onPress={onPressBot}
          onOpenMenu={onOpenBotMenu}
        />
      ))}
      <NewBotRow onCreate={onCreateBot} />
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
      active={bot.active}
      selected={selected}
      testID={`sidebar-bot-${bot.botId}`}
      onPress={handlePress}
      onOpenMenu={onOpenMenu ? handleOpenMenu : undefined}
      menuLabel={botsCopy.botSettings}
    />
  );
});
