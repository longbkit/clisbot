import { useCallback, useMemo, type ReactNode } from "react";
import { StyleSheet } from "react-native-unistyles";
import { FlatList } from "@/components/ui/scroll-view";
import { SPACING } from "@/styles/theme";
import { View } from "react-native";
import { FLAT_ROW_FILL_INSET } from "@/components/sidebar/row-geometry";
import { SidebarFilterEmptyState } from "@/components/sidebar/empty-states";
import {
  buildStatusRowProjectPresentation,
  StatusGroupHeader,
  StatusSessionRow,
  StatusWorkspaceRow,
} from "@/components/sidebar/sidebar-status-list";
import { useSidebarWorkspaceSessions } from "@/clisbot/workspace-sessions/model";
import { ProjectAboveProvider } from "@/clisbot/workspace-sessions/project-above";
import type {
  StatusDisplayGroup,
  StatusGroupItem,
} from "@/clisbot/workspace-sessions/status-sessions";
import type { HostBadgeModel } from "@/hosts/appearance";
import type { ToggleSidebarWorkspacePin } from "@/hooks/use-sidebar-workspace-pin";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";

type FlatItem =
  | { type: "header"; key: string; group: StatusDisplayGroup; collapsed: boolean }
  | { type: "row"; key: string; item: StatusGroupItem; headed: boolean; projectAbove: boolean };

/** Headers and rows in drawing order; a collapsed group keeps its header and drops its rows. */
export function flattenStatusGroups(
  groups: readonly StatusDisplayGroup[],
  collapsed: ReadonlySet<string>,
  sessionsVisible: boolean,
): FlatItem[] {
  const items: FlatItem[] = [];
  for (const group of groups) {
    const headed = group.leading.kind !== "none";
    const closed = headed && collapsed.has(group.key);
    if (headed)
      items.push({ type: "header", key: `header:${group.key}`, group, collapsed: closed });
    if (closed) continue;
    const projectAbove = sessionsVisible && group.leading.kind !== "project";
    for (const item of group.items)
      items.push({ type: "row", key: item.key, item, headed, projectAbove });
  }
  return items;
}

const keyOf = (item: FlatItem) => item.key;

/**
 * Navigation V2's Session, Workspace and Status groupings: one virtualized list in which every
 * row renders as it scrolls in — no "Show more" fold — so thousands of sessions stay smooth.
 * The pinned rows and the controls above ride along as the list's header.
 */
export function SidebarStatusFlatList({
  groups,
  projectIconByProjectViewKey,
  shortcutIndexByWorkspaceKey,
  showShortcutBadges,
  onWorkspacePress,
  hostBadgeByServerId,
  supportsPinningByServerId,
  onToggleWorkspacePin,
  listLeadingComponent,
  listHeaderComponent,
  sidebarFilterEmpty,
}: {
  groups: StatusDisplayGroup[];
  projectIconByProjectViewKey: ReadonlyMap<string, string | null>;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  showShortcutBadges: boolean;
  onWorkspacePress?: (destination?: string) => void;
  hostBadgeByServerId: ReadonlyMap<string, HostBadgeModel>;
  supportsPinningByServerId: ReadonlyMap<string, boolean>;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  listLeadingComponent?: ReactNode;
  listHeaderComponent?: ReactNode;
  sidebarFilterEmpty?: boolean;
}) {
  const collapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedWorkspaceGroupKeys);
  const { visible: sessionsVisible } = useSidebarWorkspaceSessions();
  const data = useMemo(
    () => (sidebarFilterEmpty ? [] : flattenStatusGroups(groups, collapsed, sessionsVisible)),
    [collapsed, groups, sessionsVisible, sidebarFilterEmpty],
  );
  const header = useMemo(
    () => (
      <>
        {listLeadingComponent}
        {listHeaderComponent}
        {sidebarFilterEmpty ? <SidebarFilterEmptyState /> : null}
      </>
    ),
    [listHeaderComponent, listLeadingComponent, sidebarFilterEmpty],
  );
  const renderItem = useCallback(
    ({ item }: { item: FlatItem }) => {
      if (item.type === "header")
        return (
          <StatusGroupHeader
            group={item.group}
            collapsed={item.collapsed}
            projectIconByProjectViewKey={projectIconByProjectViewKey}
          />
        );
      const row = item.item;
      const shortcutNumber = shortcutIndexByWorkspaceKey.get(row.key) ?? null;
      const canPin = supportsPinningByServerId.get(row.workspace.serverId) === true;
      return (
        <ProjectAboveProvider value={item.projectAbove}>
          {row.kind === "session" ? (
            <StatusSessionRow
              item={row}
              inGroup={item.headed}
              shortcutNumber={shortcutNumber}
              showShortcutBadge={showShortcutBadges}
              canPin={canPin}
              onToggleWorkspacePin={onToggleWorkspacePin}
              onWorkspacePress={onWorkspacePress}
            />
          ) : (
            <View style={item.headed ? undefined : styles.flatWorkspaceRow}>
              <StatusWorkspaceRow
                workspace={row.workspace}
                {...buildStatusRowProjectPresentation({
                  workspace: row.workspace,
                  projectIconByProjectViewKey,
                  hostBadgeByServerId,
                })}
                inStatusGroup={item.headed}
                shortcutNumber={shortcutNumber}
                showShortcutBadge={showShortcutBadges}
                canPin={canPin}
                onToggleWorkspacePin={onToggleWorkspacePin}
                onWorkspacePress={onWorkspacePress}
              />
            </View>
          )}
        </ProjectAboveProvider>
      );
    },
    [
      hostBadgeByServerId,
      onToggleWorkspacePin,
      onWorkspacePress,
      projectIconByProjectViewKey,
      shortcutIndexByWorkspaceKey,
      showShortcutBadges,
      supportsPinningByServerId,
    ],
  );
  return (
    <FlatList
      data={data}
      keyExtractor={keyOf}
      renderItem={renderItem}
      ListHeaderComponent={header}
      style={styles.list}
      contentContainerStyle={LIST_CONTENT}
      showsVerticalScrollIndicator={false}
      initialNumToRender={30}
      maxToRenderPerBatch={30}
      windowSize={11}
      testID="sidebar-status-list-scroll"
    />
  );
}

// Theme-free on purpose: a FlatList's content container never gets a Unistyles class on web
// (docs/unistyles.md, contentContainerStyle). The legacy status list's insets.
const LIST_CONTENT = { paddingHorizontal: SPACING[2], paddingTop: 2, paddingBottom: SPACING[4] };

const styles = StyleSheet.create({
  list: { flex: 1 },
  // A workspace row with no group header above it: its fill at `FLAT_ROW_FILL_INSET`.
  flatWorkspaceRow: { marginLeft: FLAT_ROW_FILL_INSET - SPACING[2] },
});
