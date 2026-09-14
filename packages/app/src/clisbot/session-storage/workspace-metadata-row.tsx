import { Fragment } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import { useSidebarRowItems } from "@/components/sidebar/display-preferences/model";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import { MenuRoot, MenuTrigger, MenuSurface, MenuItem } from "@/components/ui/menu";
import { sessionChannelKey } from "@getpaseo/protocol/session-authorship";
import { SessionActorLabel } from "./actor";
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

function metadataStatusLabel(status: SidebarWorkspaceEntry["authorshipStatus"]): string {
  if (status === "error") return "Metadata unavailable";
  if (status === "recovering") return "Loading metadata";
  return "Metadata pending";
}

export function WorkspaceMetadataRow({ workspace }: { workspace: SidebarWorkspaceEntry }) {
  const enabled = useSessionStorageReadable(workspace.serverId);
  const visible = useSidebarRowItems();
  if (!enabled) return null;
  const actorProps = {
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
  };
  const channels = workspace.channels ?? [];
  const status = workspace.authorshipStatus;
  const incomplete = status !== undefined && status !== "ready";
  const statusLabel = metadataStatusLabel(status);
  const items = [
    incomplete ? (
      <Text key="metadataStatus" style={styles.text} accessibilityLiveRegion="polite">
        {statusLabel}
      </Text>
    ) : null,
    visible.createdUser && workspace.createdBy ? (
      <SessionActorLabel key="createdUser" {...actorProps} actor={workspace.createdBy} />
    ) : null,
    visible.channels && channels.length > 0 ? (
      <MenuRoot key="channels">
        <MenuTrigger accessibilityLabel="Workspace channels">
          <Text style={styles.text}>
            {channels[0]!.displayName || channels[0]!.channelId}
            {channels.length > 1 ? ` +${channels.length - 1}` : ""}
          </Text>
        </MenuTrigger>
        <MenuSurface>
          {channels.map((channel) => (
            <MenuItem
              key={sessionChannelKey(channel)}
              closeOnSelect={false}
            >{`${channel.displayName || channel.channelId} · ${channel.channelId} · ${channel.hubOrigin} / ${channel.organizationId} / ${channel.connectionId}`}</MenuItem>
          ))}
        </MenuSurface>
      </MenuRoot>
    ) : null,
    !incomplete && visible.updatedUser && workspace.lastInteractionBy ? (
      <SessionActorLabel key="updatedUser" {...actorProps} actor={workspace.lastInteractionBy} />
    ) : null,
    visible.createdTime && workspace.createdAt ? (
      <MetadataTime key="createdTime" timestamp={workspace.createdAt} label="Created" />
    ) : null,
    !incomplete && visible.updatedTime && workspace.lastInteractionAt ? (
      <MetadataTime key="updatedTime" timestamp={workspace.lastInteractionAt} label="Updated" />
    ) : null,
  ].filter((item) => item !== null);
  if (!items.length) return null;
  return (
    <View style={styles.row}>
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 ? <Text style={styles.text}>·</Text> : null}
          {item}
        </Fragment>
      ))}
    </View>
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
}));
