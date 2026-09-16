import { memo, useCallback, useMemo, useRef, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SessionMetadataLine } from "@/clisbot/session-storage/workspace-metadata-row";
import { getProviderIcon } from "@/components/provider-icons";
import { isWeb } from "@/constants/platform";
import {
  WorkspaceTabIcon,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import type { SidebarSurfaceBackdrop } from "@/styles/surface-backdrop";
import { type Agent, useSessionStore } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import {
  useSidebarWorkspaceSessions,
  useWorkspaceSessions,
  useWorkspaceSessionsExpanded,
  useWorkspaceShownAgents,
} from "./model";
import type { SidebarWorkspaceSessionDetails } from "./preferences";
import type { WorkspaceSessionItem } from "./select-sessions";
import { SessionTitleTooltip } from "./session-title-tooltip";

/**
 * - `selected`: the agent in the workspace's focused pane — the session you are in. It takes the
 *   selected fill from its workspace row (`useWorkspaceRowSelectionFill`), so only one row is filled.
 * - `visible`: showing in another pane of a split. Full-strength title, no fill.
 */
type SessionLineState = "selected" | "visible" | "idle";

interface WorkspaceSessionListProps {
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
  selected: boolean;
  /** Mirrors the workspace row's own indent: status-grouped rows sit on their header's rail. */
  indented: boolean;
  /** The same hook a workspace press fires — closes the compact sidebar, for one. */
  onSessionPress?: () => void;
}

/**
 * The sessions under one workspace row, rendered as the row's sibling rather than inside it so a
 * session press never also presses, drags, or context-menus the workspace.
 *
 * A closed or feature-off row stops here, after one settings read and one expansion lookup; only
 * an open row mounts the list and its store subscriptions.
 */
export const WorkspaceSessionList = memo(function WorkspaceSessionList(
  props: WorkspaceSessionListProps,
): ReactElement | null {
  const preference = useSidebarWorkspaceSessions();
  const expanded = useWorkspaceSessionsExpanded({ ...props, preference });
  if (!expanded) return null;
  return (
    <OpenWorkspaceSessionList
      {...props}
      activeOnly={preference.activeOnly}
      fullTitles={preference.fullTitles}
      details={preference.details}
    />
  );
});

function OpenWorkspaceSessionList({
  serverId,
  workspaceId,
  workspaceKey,
  selected,
  indented,
  onSessionPress,
  activeOnly,
  fullTitles,
  details,
}: WorkspaceSessionListProps & {
  activeOnly: boolean;
  fullTitles: boolean;
  details: SidebarWorkspaceSessionDetails;
}): ReactElement | null {
  const sessions = useWorkspaceSessions({ serverId, workspaceId, activeOnly });
  const shown = useWorkspaceShownAgents({ serverId, workspaceId, enabled: selected });
  if (sessions.length === 0) return null;

  return (
    <View testID={`sidebar-workspace-sessions-${workspaceKey}`}>
      {sessions.map((session) => {
        const agentId = session.agent.id;
        let state: SessionLineState = "idle";
        if (shown.selectedAgentId === agentId) state = "selected";
        else if (shown.visibleAgentIds.has(agentId)) state = "visible";
        return (
          <WorkspaceSessionRow
            key={agentId}
            serverId={serverId}
            workspaceId={workspaceId}
            session={session}
            state={state}
            fullTitles={fullTitles}
            details={details}
            indented={indented}
            onPress={onSessionPress}
          />
        );
      })}
    </View>
  );
}

const WorkspaceSessionRow = memo(function WorkspaceSessionRow({
  serverId,
  workspaceId,
  session,
  state,
  fullTitles,
  details,
  indented,
  onPress,
}: {
  serverId: string;
  workspaceId: string;
  session: WorkspaceSessionItem;
  state: SessionLineState;
  /** Wrap the title instead of cutting it; a cut title shows in full in a hover tooltip. */
  fullTitles: boolean;
  details: SidebarWorkspaceSessionDetails;
  indented: boolean;
  onPress?: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { agent } = session;
  const label = session.title ?? t("workspace.tabs.fallback.newAgent");
  const selected = state === "selected";
  const titleRef = useRef<Text>(null);
  const handlePress = useCallback(() => {
    onPress?.();
    navigateToAgent({ serverId, workspaceId, agentId: agent.id });
  }, [onPress, serverId, workspaceId, agent.id]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      indented && styles.rowIndented,
      hovered && styles.rowHovered,
      selected && styles.rowSelected,
      pressed && styles.rowPressed,
    ],
    [indented, selected],
  );

  const row = (
    <Pressable
      accessibilityRole={isWeb ? undefined : "button"}
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      aria-selected={selected}
      onPress={handlePress}
      style={rowStyle}
      testID={`sidebar-workspace-session-${agent.id}`}
    >
      {({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => (
        <>
          <View style={styles.titleLine}>
            <SessionMark
              session={session}
              serverId={serverId}
              active={state !== "idle"}
              backdrop={resolveBackdrop(selected, hovered)}
            />
            <Text
              ref={titleRef}
              style={titleStyle(state)}
              numberOfLines={fullTitles ? undefined : 1}
            >
              {label}
            </Text>
            {details.lastActivity ? <LastActivity agent={agent} /> : null}
          </View>
          <SessionDetailLine
            serverId={serverId}
            workspaceId={workspaceId}
            session={session}
            details={details}
          />
        </>
      )}
    </Pressable>
  );
  if (fullTitles) return row;
  return (
    <SessionTitleTooltip label={label} titleRef={titleRef}>
      {row}
    </SessionTitleTooltip>
  );
});

function resolveBackdrop(selected: boolean, hovered: boolean): SidebarSurfaceBackdrop {
  if (selected) return "surfaceSidebarSelected";
  return hovered ? "surfaceSidebarHover" : "surfaceSidebar";
}

function titleStyle(state: SessionLineState) {
  // Selected and visible read the same; the fill alone marks the selected line.
  return state === "idle" ? styles.title : [styles.title, styles.titleShown];
}

/**
 * The provider mark with the session's status on it — the agent tab's own icon, so a session
 * looks the same in the sidebar as in the tab bar. It only reads `icon` and `statusBucket`.
 */
function SessionMark({
  session,
  serverId,
  active,
  backdrop,
}: {
  session: WorkspaceSessionItem;
  serverId: string;
  active: boolean;
  backdrop: SidebarSurfaceBackdrop;
}): ReactElement {
  const { provider, id } = session.agent;
  const presentation = useMemo<WorkspaceTabPresentation>(
    () => ({
      key: id,
      kind: "agent",
      label: session.title ?? "",
      subtitle: "",
      tooltip: session.title ?? "",
      modified: false,
      titleState: "ready",
      icon: getProviderIcon(provider, serverId),
      statusBucket: session.statusBucket,
    }),
    [id, provider, serverId, session.title, session.statusBucket],
  );
  return (
    <View style={styles.markSlot}>
      <WorkspaceTabIcon presentation={presentation} active={active} size={12} backdrop={backdrop} />
    </View>
  );
}

/**
 * Reads the store's `agentLastActivity` slice, as the agent directory does: activity is bumped
 * there without rewriting the agent, so `agent.lastActivityAt` alone goes stale mid-turn.
 */
function LastActivity({ agent }: { agent: Agent }): ReactElement {
  const date = useSessionStore(
    (state) => state.agentLastActivity.get(agent.id) ?? agent.lastActivityAt,
  );
  const label = useCompactTimeAgo(date);
  return <Text style={styles.trailing}>{label}</Text>;
}

function SessionDetailLine({
  serverId,
  workspaceId,
  session,
  details,
}: {
  serverId: string;
  workspaceId: string;
  session: WorkspaceSessionItem;
  details: SidebarWorkspaceSessionDetails;
}): ReactElement | null {
  const { agent } = session;
  const leadingItems = useMemo(
    () =>
      details.model && agent.model
        ? [
            <Text key="model" style={styles.detailText} numberOfLines={1}>
              {agent.model}
            </Text>,
          ]
        : [],
    [details.model, agent.model],
  );
  return (
    <SessionMetadataLine
      serverId={serverId}
      workspaceId={workspaceId}
      metadata={agent}
      createdAt={agent.createdAt.toISOString()}
      visible={details}
      channelsLabel="Session channels"
      leadingItems={leadingItems}
      style={styles.detailLine}
    />
  );
}

// The workspace title's size and line height, so a session reads at the same weight as its row.
const TITLE_LINE_HEIGHT = 20;

const styles = StyleSheet.create((theme) => ({
  // The mark starts where the workspace title starts: the workspace row's left padding, its
  // leading status column, and the gap after it. Every session sits under its workspace's
  // title, reading as a child without spending a tree line on it.
  row: {
    minHeight: 26,
    marginBottom: theme.spacing[0.5],
    paddingVertical: theme.spacing[1],
    paddingLeft: theme.spacing[2] + theme.iconSize.md + theme.spacing[2],
    paddingRight: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    justifyContent: "center",
    userSelect: "none",
  },
  rowIndented: {
    paddingLeft: theme.spacing[2] + theme.spacing[2] + theme.iconSize.md + theme.spacing[2],
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowSelected: {
    backgroundColor: theme.colors.surfaceSidebarSelected,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  // Top-aligned so a wrapped title keeps its mark and time on its first line.
  titleLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  markSlot: {
    width: theme.iconSize.sm,
    height: TITLE_LINE_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: TITLE_LINE_HEIGHT,
  },
  titleShown: {
    color: theme.colors.foreground,
  },
  trailing: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: TITLE_LINE_HEIGHT,
  },
  // Under the title, past the mark, so detail items line up with the words they describe.
  detailLine: {
    paddingLeft: theme.iconSize.sm + theme.spacing[2],
  },
  detailText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
