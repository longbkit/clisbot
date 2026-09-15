import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import { Pressable, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import {
  useSidebarWorkspaceSessions,
  useWorkspaceHasSessions,
  useWorkspaceSessionsManualToggle,
} from "./model";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const HIT_SLOP = { top: 4, bottom: 4, left: 6, right: 6 };

/**
 * The workspace row's leading column, with the sessions chevron under the status mark.
 *
 * The status mark keeps its slot at the top; the chevron takes the empty space the title's
 * second line leaves beneath it, so the row gains no width and the status never hides behind a
 * hover swap that touch cannot perform. Only `manual` expansion has a chevron, and only when the
 * workspace has a session — otherwise this returns the status mark untouched.
 *
 * The chevron sits inside the workspace row's press target. Its own Pressable takes the press, so
 * the row is not selected; a drag needs 6pt of movement first, so a tap never starts one.
 */
export function WorkspaceSessionsLeadingColumn(props: {
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
  children: ReactNode;
}): ReactNode {
  const { visible, expansion } = useSidebarWorkspaceSessions();
  if (!visible || expansion !== "manual") return props.children;
  return <ManualLeadingColumn {...props} />;
}

function ManualLeadingColumn({
  serverId,
  workspaceId,
  workspaceKey,
  children,
}: {
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
  children: ReactNode;
}): ReactNode {
  const { expanded, toggle } = useWorkspaceSessionsManualToggle(workspaceKey);
  const hasSessions = useWorkspaceHasSessions({ serverId, workspaceId });
  if (!hasSessions) return children;

  return (
    <View style={styles.column}>
      {children}
      <WorkspaceSessionsExpandToggle
        expanded={expanded}
        onToggle={toggle}
        testID={`sidebar-workspace-sessions-toggle-${workspaceKey}`}
      />
    </View>
  );
}

function WorkspaceSessionsExpandToggle({
  expanded,
  onToggle,
  testID,
}: {
  expanded: boolean;
  onToggle: () => void;
  testID: string;
}): ReactElement {
  const label = expanded ? "Hide sessions" : "Show sessions";
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const toggleStyle = useCallback(
    ({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.toggle,
      hovered && styles.toggleHovered,
    ],
    [],
  );
  const Chevron = expanded ? ThemedChevronDown : ThemedChevronRight;

  return (
    <Pressable
      accessibilityRole={isWeb ? undefined : "button"}
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      aria-expanded={expanded}
      hitSlop={HIT_SLOP}
      onPress={onToggle}
      style={toggleStyle}
      testID={testID}
    >
      <Chevron size={12} uniProps={mutedIconMapping} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  column: {
    alignItems: "center",
    flexShrink: 0,
  },
  toggle: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
  },
  toggleHovered: {
    backgroundColor: theme.colors.surface2,
  },
}));
