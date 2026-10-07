import { useState, type ReactElement, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SessionPinButton } from "@/clisbot/bots/sidebar/session-pin";
import { SidebarWorkspaceShortcutBadge } from "@/components/sidebar/sidebar-workspace-row-content";
import { SCRIM_WIDTH, TrailingActionScrim } from "@/components/ui/trailing-action-scrim";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import { type Agent, useSessionStore } from "@/stores/session-store";
import type { SidebarSurfaceBackdrop } from "@/styles/surface-backdrop";

/** What a line adds after the pin, with the menu's open state lifted to the line. */
export interface SessionLineActionsInput {
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}

/**
 * The end of a session's title line. Last activity (or the shortcut badge) keeps its slot all
 * the time, so the title never rewraps. On hover the pin and any line actions float over the
 * slot and the title's tail, on the row's own background with a fade into the text — the shape
 * of the workspace row's trailing overlay (`SidebarWorkspaceTrailingActionOverlay`). Touch has
 * no hover, so there the actions sit in the line for good and Last activity gives way to them.
 *
 * The menu's open state lives here, not in the menu: the actions only render while the line is
 * hovered or the menu is open, so a menu whose surface takes the pointer off the line is not
 * unmounted under itself.
 */
export function SessionLineTrailing({
  serverId,
  agent,
  rowHovered,
  selected,
  showActivity,
  badgeNumber,
  renderActions,
}: {
  serverId: string;
  agent: Agent;
  rowHovered: boolean;
  selected: boolean;
  showActivity: boolean;
  /** The shortcut number while its modifier is held; the actions stay out of its way. */
  badgeNumber: number | null;
  renderActions?: (input: SessionLineActionsInput) => ReactNode;
}): ReactElement {
  const touch = useIsCompactFormFactor() || isNative;
  const [menuOpen, setMenuOpen] = useState(false);
  const agentId = agent.id;
  if (badgeNumber !== null) {
    return (
      <View style={styles.slot}>
        <SidebarWorkspaceShortcutBadge number={badgeNumber} />
      </View>
    );
  }
  const actions = (
    <>
      <SessionPinButton serverId={serverId} agentId={agentId} />
      {renderActions?.({ menuOpen, onMenuOpenChange: setMenuOpen })}
    </>
  );
  if (touch) return <View style={styles.inline}>{actions}</View>;
  const backdrop = resolveActionsBackdrop({ selected, rowHovered });
  return (
    <View style={styles.slot}>
      {showActivity ? <LastActivity agent={agent} /> : null}
      {rowHovered || menuOpen ? (
        <View style={styles.overlay} testID={`sidebar-session-actions-${agentId}`}>
          <View style={styles.fade} pointerEvents="none">
            <TrailingActionScrim backdrop={backdrop} />
          </View>
          <View style={[styles.actions, BACKDROP_STYLES[backdrop]]}>{actions}</View>
        </View>
      ) : null}
    </View>
  );
}

function resolveActionsBackdrop(input: {
  selected: boolean;
  rowHovered: boolean;
}): SidebarSurfaceBackdrop {
  if (input.selected) return "surfaceSidebarSelected";
  return input.rowHovered ? "surfaceSidebarHover" : "surfaceSidebar";
}

// The scrim is solid past 55% of its width; the actions sit over that part, so what shows is the
// fade alone.
const FADE_OVERLAP = 20;

/**
 * Reads the store's `agentLastActivity` slice, as the agent directory does: activity is bumped
 * there without rewriting the agent, so `agent.lastActivityAt` alone goes stale mid-turn.
 */
function LastActivity({ agent }: { agent: Agent }): ReactElement {
  const date = useSessionStore(
    (state) => state.agentLastActivity.get(agent.id) ?? agent.lastActivityAt,
  );
  const label = useCompactTimeAgo(date);
  return <Text style={styles.activity}>{label}</Text>;
}

const styles = StyleSheet.create((theme) => ({
  // Relative at whatever width Last activity takes, so the overlay anchors to the line's end.
  slot: {
    position: "relative",
    minHeight: 20,
    flexShrink: 0,
    alignItems: "flex-end",
  },
  activity: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
    lineHeight: 20,
  },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    marginVertical: -theme.spacing[1],
  },
  overlay: {
    position: "absolute",
    top: -theme.spacing[1],
    right: 0,
    flexDirection: "row",
    alignItems: "stretch",
  },
  fade: { width: SCRIM_WIDTH },
  actions: {
    marginLeft: -FADE_OVERLAP,
    paddingLeft: FADE_OVERLAP / 2,
    flexDirection: "row",
    alignItems: "center",
  },
  surfaceSidebar: { backgroundColor: theme.colors.surfaceSidebar },
  surfaceSidebarHover: { backgroundColor: theme.colors.surfaceSidebarHover },
  surfaceSidebarSelected: { backgroundColor: theme.colors.surfaceSidebarSelected },
  surface2: { backgroundColor: theme.colors.surface2 },
}));

const BACKDROP_STYLES: Record<SidebarSurfaceBackdrop, object> = {
  surfaceSidebar: styles.surfaceSidebar,
  surfaceSidebarHover: styles.surfaceSidebarHover,
  surfaceSidebarSelected: styles.surfaceSidebarSelected,
  surface2: styles.surface2,
};
