import { Fragment, type ReactElement } from "react";
import { Text, View, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import { useSidebarRowItems } from "@/components/sidebar/display-preferences/model";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import {
  type SessionAuthorship,
  type SessionChannelReference,
} from "@getpaseo/protocol/session-authorship";
import { ChannelIcon, channelConversationLabel } from "@/clisbot/channels/channel-icon";
import { SessionActorName } from "./actor";
import { useSessionStorageReadable } from "./capability";

function MetadataTime({ timestamp, label }: { timestamp: string; label: string }) {
  const date = new Date(timestamp);
  const valid = Number.isFinite(date.getTime());
  const compact = useCompactTimeAgo(valid ? date : null);
  if (!valid) return null;
  const full = `${label}: ${date.toLocaleString(undefined, { timeZoneName: "long" })}`;
  return (
    <Tooltip enabledOnMobile>
      <TooltipTrigger accessibilityLabel={full}>
        <Text style={styles.text}>{compact}</Text>
      </TooltipTrigger>
      <TooltipContent>
        <Text style={styles.text}>{full}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function metadataStatusLabel(status: SessionAuthorship["authorshipStatus"]): string {
  if (status === "error") return "Metadata unavailable";
  if (status === "recovering") return "Loading metadata";
  return "Metadata pending";
}

/**
 * Where the work came from, as plain content for the same reason a name is: the row around it
 * owns the press. The conversation beyond the first is counted rather than listed, so a line
 * that holds several stays one line.
 */
function ChannelsItem({
  channels,
  accessibilityLabel,
}: {
  channels: readonly SessionChannelReference[];
  accessibilityLabel: string;
}) {
  const first = channels[0]!;
  return (
    <View style={styles.channel} accessibilityLabel={accessibilityLabel}>
      <ChannelIcon channel={first.channel} />
      <Text style={styles.text} numberOfLines={1}>
        {channelConversationLabel(first)}
        {channels.length > 1 ? ` +${channels.length - 1}` : ""}
      </Text>
    </View>
  );
}

export interface SessionMetadataVisibility {
  createdUser: boolean;
  updatedUser: boolean;
  channels: boolean;
  createdTime: boolean;
  updatedTime: boolean;
}

/** The items that need session storage, split around Created time to keep the line's order. */
function authorshipItems({
  metadata,
  visible,
  channelsLabel,
}: {
  metadata: SessionAuthorship;
  visible: SessionMetadataVisibility;
  channelsLabel: string;
}): { before: (ReactElement | null)[]; after: (ReactElement | null)[] } {
  const channels = metadata.channels ?? [];
  const status = metadata.authorshipStatus;
  const incomplete = status !== undefined && status !== "ready";
  return {
    before: [
      incomplete ? (
        <Text key="metadataStatus" style={styles.text} accessibilityLiveRegion="polite">
          {metadataStatusLabel(status)}
        </Text>
      ) : null,
      visible.createdUser && metadata.createdBy ? (
        <SessionActorName key="createdUser" actor={metadata.createdBy} />
      ) : null,
      visible.channels && channels.length > 0 ? (
        <ChannelsItem key="channels" channels={channels} accessibilityLabel={channelsLabel} />
      ) : null,
      !incomplete && visible.updatedUser && metadata.lastInteractionBy ? (
        <SessionActorName key="updatedUser" actor={metadata.lastInteractionBy} />
      ) : null,
    ],
    after: [
      !incomplete && visible.updatedTime && metadata.lastInteractionAt ? (
        <MetadataTime key="updatedTime" timestamp={metadata.lastInteractionAt} label="Updated" />
      ) : null,
    ],
  };
}

/**
 * The user/channel/time items for anything carrying session authorship — a workspace row's meta
 * line and a session line under it read the same fields, so they draw them the same way.
 *
 * `leadingItems` go first on the line (a session line puts its model there). Returns null when
 * nothing is left to show, so callers never render an empty line.
 */
export function SessionMetadataLine({
  serverId,
  metadata,
  createdAt,
  visible,
  channelsLabel,
  leadingItems = [],
  style,
}: {
  serverId: string;
  metadata: SessionAuthorship;
  createdAt: string | undefined;
  visible: SessionMetadataVisibility;
  channelsLabel: string;
  leadingItems?: ReactElement[];
  /** Extra layout for the line, e.g. a session line's indent under its title. */
  style?: ViewStyle;
}) {
  const enabled = useSessionStorageReadable(serverId);
  const authored = enabled
    ? authorshipItems({ metadata, visible, channelsLabel })
    : { before: [], after: [] };
  // Created time is not authorship — the agent or workspace record carries it — so it shows on any
  // host that sends it. Every other item needs session storage.
  const created =
    visible.createdTime && createdAt ? (
      <MetadataTime key="createdTime" timestamp={createdAt} label="Created" />
    ) : null;
  const items = [...leadingItems, ...authored.before, created, ...authored.after].filter(
    (item) => item !== null,
  );
  if (!items.length) return null;
  return (
    <View style={[styles.row, style]}>
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 ? <Text style={styles.text}>·</Text> : null}
          {item}
        </Fragment>
      ))}
    </View>
  );
}

export function WorkspaceMetadataRow({ workspace }: { workspace: SidebarWorkspaceEntry }) {
  const visible = useSidebarRowItems();
  return (
    <SessionMetadataLine
      serverId={workspace.serverId}
      metadata={workspace}
      createdAt={workspace.createdAt}
      visible={visible}
      channelsLabel="Workspace channels"
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  channel: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1], minWidth: 0 },
}));
