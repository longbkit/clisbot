import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SessionMetadataLine } from "@/clisbot/session-storage/workspace-metadata-row";
import { useProviderIcon } from "@/components/provider-icons";
import { isWeb } from "@/constants/platform";
import type { WorkspaceTabPresentation } from "@/screens/workspace/workspace-tab-presentation";
import type { SidebarSurfaceBackdrop } from "@/styles/surface-backdrop";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import {
  useSidebarWorkspaceSessions,
  useWorkspaceSessions,
  useWorkspaceSessionsExpanded,
  useWorkspaceShownAgents,
} from "./model";
import type { SidebarWorkspaceSessionDetails } from "./preferences";
import type { WorkspaceSessionItem } from "./select-sessions";
import { ProjectAboveLine } from "./project-above";
import { SessionLineTrailing, type SessionLineActionsInput } from "./session-line-trailing";
import { SessionTitleTooltip } from "./session-title-tooltip";
import { shownAgentIds } from "./shown-agents";

/**
 * - `selected`: the agent in the workspace's focused pane — the session you are in. It takes the
 *   selected fill from its workspace row (`useWorkspaceRowSelectionFill`), so only one row is filled.
 * - `visible`: showing in another pane of a split. Full-strength title, no fill.
 */
export type SessionLineState = "selected" | "visible" | "idle";

/**
 * - `flush` / `indented`: under a workspace row, the title on the workspace title's rail.
 * - `statusGroup`: in a workspace row's place under a group header, the mark on the row's rail.
 * - `topLevel`: in a workspace row's place with no header above, flush like a pinned row.
 */
export type SessionLinePlacement = "flush" | "indented" | "statusGroup" | "topLevel";

// The presentation module also imports the panel registry and terminal renderer. Load it only
// when a session icon is actually rendered, after the app's navigator polyfill has run.
const WorkspaceTabIcon = lazy(async () => ({
  default: (await import("@/screens/workspace/workspace-tab-presentation")).WorkspaceTabIcon,
}));

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
  const shown = useWorkspaceShownAgents({ serverId, workspaceId, enabled: selected });
  const keepAgentIds = useMemo(() => shownAgentIds(shown), [shown]);
  const sessions = useWorkspaceSessions({ serverId, workspaceId, activeOnly, keepAgentIds });
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
            placement={indented ? "indented" : "flush"}
            onPress={onSessionPress}
          />
        );
      })}
    </View>
  );
}

export interface WorkspaceSessionRowProps {
  serverId: string;
  workspaceId: string;
  session: WorkspaceSessionItem;
  state: SessionLineState;
  /** Wrap the title instead of cutting it; a cut title shows in full in a hover tooltip. */
  fullTitles: boolean;
  details: SidebarWorkspaceSessionDetails;
  placement: SessionLinePlacement;
  /** Names the workspace on a line that has no workspace row above it. */
  workspaceLabel?: string;
  /** Names the project above the title, on a line that has no project header above it. */
  projectLabel?: string;
  /** The shortcut number, in Last activity's place while its modifier is held. */
  badgeNumber?: number | null;
  /**
   * Actions after the pin on hover — a line standing in a workspace row's place adds the row's
   * menu. See `SessionLineTrailing`.
   */
  renderActions?: (input: SessionLineActionsInput) => ReactNode;
  onPress?: () => void;
}

export const WorkspaceSessionRow = memo(function WorkspaceSessionRow({
  serverId,
  workspaceId,
  session,
  state,
  fullTitles,
  details,
  placement,
  workspaceLabel,
  projectLabel,
  badgeNumber = null,
  renderActions,
  onPress,
}: WorkspaceSessionRowProps): ReactElement {
  const { t } = useTranslation();
  const [rowHovered, setRowHovered] = useState(false);
  const hoverIn = useCallback(() => setRowHovered(true), []);
  const hoverOut = useCallback(() => setRowHovered(false), []);
  const { agent } = session;
  const label = session.title ?? t("workspace.tabs.fallback.newAgent");
  const selected = state === "selected";
  const wide = placement === "statusGroup" || placement === "topLevel";
  const titleRef = useRef<Text>(null);
  const handlePress = useCallback(() => {
    onPress?.();
    navigateToAgent({ serverId, workspaceId, agentId: agent.id });
  }, [onPress, serverId, workspaceId, agent.id]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const rowStyle = useSessionRowStyle({ placement, selected, rowHovered });

  const row = (
    <View style={sessionWrapper} onPointerEnter={hoverIn} onPointerLeave={hoverOut}>
      <View style={sessionContent}>
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
              {projectLabel ? <ProjectAboveLine name={projectLabel} /> : null}
              <View style={styles.titleLine}>
                <SessionMark
                  session={session}
                  serverId={serverId}
                  active={state !== "idle"}
                  backdrop={resolveBackdrop(selected, hovered)}
                  wide={wide}
                />
                <Text
                  ref={titleRef}
                  style={titleStyle(state)}
                  numberOfLines={fullTitles ? undefined : 1}
                >
                  {label}
                </Text>
                <SessionLineTrailing
                  serverId={serverId}
                  rowHovered={rowHovered}
                  selected={selected}
                  agent={agent}
                  showActivity={details.lastActivity}
                  badgeNumber={badgeNumber}
                  renderActions={renderActions}
                />
              </View>
              <SessionDetailLine
                serverId={serverId}
                session={session}
                details={details}
                wide={wide}
                workspaceLabel={workspaceLabel === label ? undefined : workspaceLabel}
              />
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
  if (fullTitles) return row;
  return (
    <SessionTitleTooltip label={label} titleRef={titleRef}>
      {row}
    </SessionTitleTooltip>
  );
});

function useSessionRowStyle({
  placement,
  selected,
  rowHovered,
}: {
  placement: SessionLinePlacement;
  selected: boolean;
  rowHovered: boolean;
}) {
  return useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      placement === "indented" && styles.rowIndented,
      placement === "statusGroup" && styles.rowInStatusGroup,
      placement === "topLevel" && styles.rowTopLevel,
      (hovered || rowHovered) && styles.rowHovered,
      selected && styles.rowSelected,
      pressed && styles.rowPressed,
    ],
    [placement, selected, rowHovered],
  );
}

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
  wide,
}: {
  session: WorkspaceSessionItem;
  serverId: string;
  active: boolean;
  backdrop: SidebarSurfaceBackdrop;
  /** The workspace row's leading column width, for a line standing in a row's place. */
  wide: boolean;
}): ReactElement {
  const { provider, id } = session.agent;
  const icon = useProviderIcon(provider, serverId);
  const presentation = useMemo<WorkspaceTabPresentation>(
    () => ({
      key: id,
      kind: "agent",
      label: session.title ?? "",
      subtitle: "",
      tooltip: session.title ?? "",
      modified: false,
      titleState: "ready",
      // A sidebar line has no close control; only the tab bar offers one.
      showCloseButton: false,
      icon,
      statusBucket: session.statusBucket,
    }),
    [icon, id, session.title, session.statusBucket],
  );
  return (
    <View style={[styles.markSlot, wide && styles.markSlotWide]}>
      <Suspense fallback={null}>
        <WorkspaceTabIcon
          presentation={presentation}
          active={active}
          size={12}
          backdrop={backdrop}
        />
      </Suspense>
    </View>
  );
}

function SessionDetailLine({
  serverId,
  session,
  details,
  wide,
  workspaceLabel,
}: {
  serverId: string;
  session: WorkspaceSessionItem;
  details: SidebarWorkspaceSessionDetails;
  wide: boolean;
  workspaceLabel?: string;
}): ReactElement | null {
  const { agent } = session;
  const leadingItems = useMemo(() => {
    const items: ReactElement[] = [];
    if (workspaceLabel) {
      items.push(
        <Text key="workspace" style={styles.detailText} numberOfLines={1}>
          {workspaceLabel}
        </Text>,
      );
    }
    if (details.model && agent.model) {
      items.push(
        <Text key="model" style={styles.detailText} numberOfLines={1}>
          {agent.model}
        </Text>,
      );
    }
    return items;
  }, [workspaceLabel, details.model, agent.model]);
  return (
    <SessionMetadataLine
      serverId={serverId}
      metadata={agent}
      createdAt={agent.createdAt.toISOString()}
      visible={details}
      channelsLabel="Session channels"
      leadingItems={leadingItems}
      style={wide ? styles.detailLineWide : styles.detailLine}
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
  // A status-grouped workspace row's indent (`sidebarWorkspaceRowStyles.rowIndented`), so the
  // mark sits in the rows' leading column and the title on their title rail.
  rowInStatusGroup: {
    paddingLeft: theme.spacing[2] + theme.spacing[2],
  },
  // A workspace row's own left padding, for a line with no header above it: the Session
  // grouping, which lists straight under the Projects section.
  rowTopLevel: {
    paddingLeft: theme.spacing[2],
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowSelected: {
    backgroundColor: theme.colors.surfaceSidebarSelected,
    ...theme.shadow.raised,
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
  markSlotWide: {
    width: theme.iconSize.md,
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: TITLE_LINE_HEIGHT,
  },
  titleShown: {
    fontWeight: theme.fontWeight.medium,
  },
  // Under the title, past the mark, so detail items line up with the words they describe.
  detailLine: {
    paddingLeft: theme.iconSize.sm + theme.spacing[2],
  },
  detailLineWide: {
    paddingLeft: theme.iconSize.md + theme.spacing[2],
  },
  detailText: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
}));

const sessionWrapper = { position: "relative" } as const;
const sessionContent = { minWidth: 0 };
