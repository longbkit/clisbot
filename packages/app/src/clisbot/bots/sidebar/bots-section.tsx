import type { Rect } from "@/components/ui/menu/menu-anchor";
import { DirectoryControls } from "./directory-controls";
import {
  filterDirectoryBots,
  type DirectorySort,
  type DirectoryOwnership,
} from "./directory-model";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { recentSidebarBots } from "./sidebar-model";
import { FormTextInput } from "@/components/ui/form-field";
import { FlatList } from "@/components/ui/scroll-view";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useSessionStore, selectAgentTurnPresentation } from "@/stores/session-store";
import { memo, useCallback, useMemo, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { BotFace } from "../chat/bot-face";
import { botsCopy } from "../copy";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import { BotsSidebarRow } from "./row";
import type { BotLaunch } from "./display/row-detail";
import { useBotRowDetail } from "./display/use-row-detail";
import { SectionDisplayMenu } from "./display/section-display-menu";
import { BotsSectionHeader, useSectionCollapsed } from "./section-header";

export interface BotsSidebarBot {
  /** `${serverId}:${botId}`, unique across hosts. */
  key: string;
  serverId: string;
  botId: string;
  name: string;
  avatar?: string | null;
  /** Shown under the name when more than one host has bots. */
  hostLabel?: string | null;
  hostName?: string;
  description?: string | null;
  launch?: BotLaunch;
  /** The current user’s direct-chat session is running. */
  active?: boolean;
  updatedAt?: string;
  agentId?: string | null;
  canConfigure?: boolean;
  isOwner?: boolean;
}

interface BotsSectionProps {
  bots: readonly BotsSidebarBot[];
  directoryBots?: readonly BotsSidebarBot[];
  directoryHosts?: readonly { serverId: string; serverName: string }[];
  loading?: boolean;
  loadError?: string | null;
  onRetry?: () => void;
  selectedBotKey?: string | null;
  /** The Grok gesture: the row opens (or creates) the direct chat; the caller owns that. */
  onPressBot: (bot: BotsSidebarBot) => void;
  onOpenBotMenu?: (bot: BotsSidebarBot, anchor: Rect) => void;
  onCreateBot: () => void;
  canCreateBot?: boolean;
}

/** Each bot is its personal direct-chat entry; creation stays in the header. */
export const BotsSection = memo(function BotsSection({
  bots,
  directoryBots = bots,
  directoryHosts = emptyHosts,
  loading = false,
  loadError = null,
  onRetry,
  selectedBotKey = null,
  onPressBot,
  onOpenBotMenu,
  onCreateBot,
  canCreateBot = true,
}: BotsSectionProps) {
  const [directory, setDirectory] = useState(false);
  const openDirectory = useCallback(() => setDirectory(true), []);
  const closeDirectory = useCallback(() => setDirectory(false), []);
  const [collapsed, toggleCollapsed] = useSectionCollapsed("bots");
  return (
    <View testID="sidebar-bots-section">
      <BotsSectionHeader
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        label={botsCopy.bots}
        testID="sidebar-bots-header"
        createLabel={botsCopy.form.create}
        onCreate={onCreateBot}
        disabled={!canCreateBot}
        actions={botsDisplayMenu}
      />
      {!collapsed ? (
        <>
          {recentSidebarBots(bots, selectedBotKey).map((bot) => (
            <BotRow
              key={bot.key}
              bot={bot}
              selected={bot.key === selectedBotKey}
              onPress={onPressBot}
              onOpenMenu={onOpenBotMenu}
            />
          ))}
          <Pressable
            style={directoryStyles.link}
            onPress={openDirectory}
            accessibilityRole="button"
          >
            <Text style={directoryStyles.text}>View all bots ({directoryBots.length})</Text>
          </Pressable>
        </>
      ) : null}
      <BotDirectory
        visible={directory}
        hosts={directoryHosts}
        loading={loading}
        error={loadError}
        onRetry={onRetry}
        bots={directoryBots}
        selectedBotKey={selectedBotKey}
        onClose={closeDirectory}
        onPress={onPressBot}
        onOpenMenu={onOpenBotMenu}
      />
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
  onOpenMenu?: (bot: BotsSidebarBot, anchor: Rect) => void;
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
  const detail = useBotRowDetail(bot);
  const handlePress = useCallback(() => onPress(bot), [bot, onPress]);
  const handleOpenMenu = useCallback(
    (anchor: Rect) => onOpenMenu?.(bot, anchor),
    [bot, onOpenMenu],
  );
  const face = useMemo(
    () => <BotFace botId={bot.botId} name={bot.name} avatar={bot.avatar} />,
    [bot.avatar, bot.botId, bot.name],
  );
  return (
    <BotsSidebarRow
      leading={face}
      title={bot.name}
      subtitle={detail}
      active={bot.active ?? active}
      trailing={bot.updatedAt ? timeAgo : null}
      selected={selected}
      testID={`sidebar-bot-${bot.botId}`}
      onPress={handlePress}
      onOpenMenu={onOpenMenu ? handleOpenMenu : undefined}
      menuLabel="Bot options"
    />
  );
});

const botsDisplayMenu = <SectionDisplayMenu section="bots" />;

const directoryStyles = StyleSheet.create((theme) => ({
  directory: { minHeight: 280, maxHeight: 520, flexShrink: 1, gap: 8 },
  list: { flexGrow: 0, flexShrink: 1 },
  link: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  search: {
    minHeight: 44,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    color: theme.colors.foreground,
  },
}));

const emptyHosts: readonly { serverId: string; serverName: string }[] = [];
const directoryHeader = { title: "Bots" };
const botKey = (bot: BotsSidebarBot) => bot.key;
function EmptyDirectory() {
  return <Text style={directoryStyles.text}>No matching bots</Text>;
}
function BotDirectory({
  visible,
  hosts,
  loading,
  error,
  onRetry,
  bots,
  selectedBotKey,
  onClose,
  onPress,
  onOpenMenu,
}: {
  visible: boolean;
  hosts: readonly { serverId: string; serverName: string }[];
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  bots: readonly BotsSidebarBot[];
  selectedBotKey?: string | null;
  onClose: () => void;
  onPress: (bot: BotsSidebarBot) => void;
  onOpenMenu?: (bot: BotsSidebarBot, anchor: Rect) => void;
}) {
  const [query, setQuery] = useState("");
  const [hostId, setHostId] = useState("");
  const [sort, setSort] = useState<DirectorySort>("recent");
  const [ownership, setOwnership] = useState<DirectoryOwnership>("all");
  const results = useMemo(
    () => filterDirectoryBots(bots, query, hostId, sort, ownership),
    [bots, query, hostId, sort, ownership],
  );
  const open = useCallback(
    (bot: BotsSidebarBot) => {
      onClose();
      onPress(bot);
    },
    [onClose, onPress],
  );
  const openMenu = useCallback(
    (bot: BotsSidebarBot, anchor: Rect) => {
      onClose();
      onOpenMenu?.(bot, anchor);
    },
    [onClose, onOpenMenu],
  );
  const renderItem = useCallback(
    ({ item }: { item: BotsSidebarBot }) => (
      <BotRow
        bot={item}
        selected={item.key === selectedBotKey}
        onPress={open}
        onOpenMenu={onOpenMenu ? openMenu : undefined}
      />
    ),
    [selectedBotKey, open, onOpenMenu, openMenu],
  );
  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={directoryHeader}
      scrollable={false}
    >
      <View style={directoryStyles.directory}>
        <FormTextInput
          initialValue={query}
          onChangeText={setQuery}
          placeholder="Search bots or Hosts…"
          accessibilityLabel="Search bots or Hosts"
        />
        <DirectoryControls
          hosts={hosts}
          ownership={ownership}
          onOwnership={setOwnership}
          ownershipUnknown={bots.some((bot) => bot.isOwner === undefined)}
          hostId={hostId}
          sort={sort}
          onHost={setHostId}
          onSort={setSort}
        />
        <DirectoryLoadStatus loading={loading} error={error} onRetry={onRetry} />
        <FlatList
          data={results}
          keyExtractor={botKey}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={loading || error ? null : EmptyDirectory}
          renderItem={renderItem}
          style={directoryStyles.list}
        />
      </View>
    </AdaptiveModalSheet>
  );
}

function DirectoryLoadStatus({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
}) {
  if (loading)
    return (
      <View accessibilityLabel="Loading bots" style={directoryStyles.link}>
        <DirectorySpinner uniProps={spinnerColor} />
      </View>
    );
  if (!error) return null;
  return (
    <View>
      <Text accessibilityRole="alert" style={directoryStyles.text}>
        {error}
      </Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={directoryStyles.link}>
          <Text style={directoryStyles.text}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const DirectorySpinner = withUnistyles(LoadingSpinner);
const spinnerColor = (theme: import("@/styles/theme").Theme) => ({
  color: theme.colors.foregroundMuted,
});
