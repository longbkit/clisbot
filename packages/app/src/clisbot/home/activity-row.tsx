import { i18n } from "@/i18n/i18next";
import { useCallback, useLayoutEffect, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useTimeAgo } from "@/hooks/use-time-ago";
import { useProviderIcon } from "@/components/provider-icons";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { findHighlightRanges } from "@/components/ui/highlighted-text-segments";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { activityBucket, isUnreadReply } from "./activity";
import { traceInstant } from "@/performance/native-trace";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";
import { isCachedAgent } from "@/clisbot/navigation/source-liveness";
import { openPreloads } from "@/open-preload/live";
import {
  FLAT_ROW_FILL_INSET,
  SIDEBAR_TWO_LINE_ROW_HEIGHT,
  sidebarLeadingColumnWidth,
} from "@/components/sidebar/row-geometry";

/** Why a conversation sits in Needs you, in the words the row shows. */
export function activityStatus(
  agent: AggregatedAgent,
): { label: string; variant: StatusBadgeVariant } | null {
  if (agent.archivedAt) return { label: i18n.t("home.activity.status.archived"), variant: "muted" };
  if (activityBucket(agent) !== "needs") return null;
  if ((agent.pendingPermissionCount ?? 0) > 0 || agent.attentionReason === "permission")
    return { label: i18n.t("home.activity.status.needsApproval"), variant: "warning" };
  if (agent.status === "error" || agent.attentionReason === "error")
    return { label: i18n.t("home.activity.status.failed"), variant: "error" };
  return { label: i18n.t("home.activity.status.needsYou"), variant: "warning" };
}

/**
 * Where a conversation runs, as the parts the context line shows: project, then the workspace
 * and branch when they add something, then the Host when there is more than one.
 */
export function activityContext(
  agent: AggregatedAgent,
  showHost: boolean,
): { field: "project" | "workspace" | "branch" | "host"; text: string }[] {
  const project = agent.projectPlacement?.projectName ?? "";
  const workspace = agent.projectPlacement?.workspaceName ?? "";
  const branch = agent.projectPlacement?.checkout.currentBranch ?? "";
  const parts: { field: "project" | "workspace" | "branch" | "host"; text: string }[] = [];
  if (project) parts.push({ field: "project", text: project });
  if (workspace && workspace !== project) parts.push({ field: "workspace", text: workspace });
  if (branch && branch !== workspace) parts.push({ field: "branch", text: branch });
  if (showHost && agent.serverLabel) parts.push({ field: "host", text: agent.serverLabel });
  return parts;
}

/**
 * One conversation in Home's activity and in Inbox: what it is, where it runs, and why it
 * needs you. A list-as-page row (design.md §5): spacing and hover, no border.
 */
export function ActivityRow({
  agent,
  search,
  showHost,
  onPress,
  onLongPress,
  homeBucket,
}: {
  agent: AggregatedAgent;
  search?: string;
  showHost: boolean;
  onPress: (agent: AggregatedAgent) => void;
  onLongPress?: (agent: AggregatedAgent) => void;
  /** The held Home section may lag the live status until the reader applies updates. */
  homeBucket?: string;
}) {
  traceInstant("clisbot.activity.row.render");
  useLayoutEffect(() => {
    traceInstant("clisbot.activity.row.commit", { bucket: homeBucket ?? "inbox" });
  });
  const { t } = useTranslation();
  const title = agent.title || t("agentList.fallbackTitle");
  const context = activityContext(agent, showHost);
  const status = activityStatus(agent) ?? heldActivityStatus(agent, homeBucket);
  const time = useTimeAgo(agent.lastActivityAt);
  const titleRanges = useMemo(() => findHighlightRanges(search ?? "", title), [search, title]);
  const press = useCallback(() => onPress(agent), [onPress, agent]);
  const longPress = useCallback(() => onLongPress?.(agent), [onLongPress, agent]);
  const pressIn = useCallback(
    () => openPreloads.preloadAgent({ serverId: agent.serverId, agentId: agent.id }),
    [agent.serverId, agent.id],
  );
  return (
    <Pressable
      style={rowStyle}
      onPress={press}
      onPressIn={pressIn}
      onLongPress={longPress}
      accessibilityRole="button"
      testID={`agent-row-${agent.serverId}-${agent.id}`}
    >
      <View style={[styles.leading, NAVIGATION_V2_ENABLED && styles.leadingV2]}>
        <ProviderGlyph provider={agent.provider} serverId={agent.serverId} />
      </View>
      <View style={styles.content}>
        <View style={styles.titleRow}>
          {isUnreadReply(agent) ? (
            <View style={styles.unread} accessibilityLabel={t("home.activity.unreadReply")} />
          ) : null}
          <HighlightedText
            text={title}
            ranges={titleRanges}
            style={styles.title}
            numberOfLines={1}
            testID={`agent-row-title-${agent.serverId}-${agent.id}`}
          />
        </View>
        {context.length ? (
          <Text style={styles.context} numberOfLines={1}>
            {context.map((part, index) => (
              <Text key={part.field}>
                {index ? " · " : ""}
                <HighlightedText
                  text={part.text}
                  ranges={findHighlightRanges(search ?? "", part.text)}
                  style={styles.context}
                  testID={`agent-row-${part.field}-${agent.serverId}-${agent.id}`}
                />
              </Text>
            ))}
          </Text>
        ) : null}
      </View>
      <View style={styles.trailing}>
        {status ? <StatusBadge label={status.label} variant={status.variant} size="xs" /> : null}
        <Text style={styles.time} numberOfLines={1}>
          {time}
        </Text>
      </View>
    </Pressable>
  );
}

export function heldActivityStatus(
  agent: AggregatedAgent,
  homeBucket?: string,
): ReturnType<typeof activityStatus> {
  if (!homeBucket) return null;
  // A cached session's turn is unknown, not finished (navigation/source-liveness.ts).
  if (isCachedAgent(agent)) return null;
  const current = activityBucket(agent);
  if (current === "active" && homeBucket !== "active")
    return { label: i18n.t("home.activity.status.running"), variant: "muted" };
  if (current === "recent" && (homeBucket === "active" || homeBucket === "needs"))
    return { label: i18n.t("home.activity.status.finished"), variant: "muted" };
  return null;
}

function ProviderGlyphIcon({
  provider,
  serverId,
  color,
  size,
}: {
  provider: string;
  serverId: string;
  color: string;
  size: number;
}) {
  const Icon = useProviderIcon(provider, serverId);
  return <Icon size={size} color={color} />;
}
const ProviderGlyph = withUnistyles(ProviderGlyphIcon, (theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
}));

const rowStyle = ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
  styles.row,
  NAVIGATION_V2_ENABLED && styles.rowV2,
  hovered && styles.rowHovered,
  pressed && styles.rowPressed,
];

const styles = StyleSheet.create((t) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing[3],
    paddingVertical: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    borderRadius: t.borderRadius.lg,
  },
  // Navigation V2: the Chats and Workspace rows' rails, so the title sits where theirs do.
  // The feed's 12px padding is the controls' inset; the fill pulls out to `FLAT_ROW_FILL_INSET`.
  rowV2: {
    gap: t.spacing[2],
    minHeight: SIDEBAR_TWO_LINE_ROW_HEIGHT,
    marginHorizontal: FLAT_ROW_FILL_INSET - t.spacing[3],
    paddingHorizontal: t.spacing[3] - FLAT_ROW_FILL_INSET,
  },
  rowHovered: { backgroundColor: t.colors.surface1 },
  rowPressed: { backgroundColor: t.colors.surface2 },
  leading: { width: t.iconSize.sm, alignItems: "center" },
  leadingV2: { width: sidebarLeadingColumnWidth(t) },
  content: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: t.spacing[1.5] },
  title: { color: t.colors.foreground, fontSize: t.fontSize.base, flexShrink: 1 },
  unread: {
    width: 6,
    height: 6,
    borderRadius: t.borderRadius.full,
    backgroundColor: t.colors.accent,
  },
  context: { color: t.colors.foregroundMuted, fontSize: t.fontSize.sm },
  trailing: { flexDirection: "row", alignItems: "center", gap: t.spacing[2], flexShrink: 0 },
  time: { color: t.colors.foregroundMuted, fontSize: t.fontSize.sm },
}));
