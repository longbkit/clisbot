import { SPACING } from "@/styles/theme";
import { buttonControlHeight, MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHasFinePointer } from "@/hooks/use-fine-pointer";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { PluginSidebarItem } from "@/plugins/sidebar-items";
import { useSidebarFooterItems } from "@/sidebar-nav/use-sidebar-footer-items";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { UsageSidebarItem, UsageSidebarRoot, useHasUsageSummary } from "@/usage";
import { FolderPlus, Import, Settings } from "lucide-react-native";
import { useRef } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  FOOTER_SEARCH_MIN_WIDTH,
  FooterIconButton,
  FooterSearchField,
  SidebarHostPicker,
  SidebarUsageIcon,
} from "./sidebar-footer-controls";
import { SidebarHelpMenu } from "./sidebar-help-menu";
import { SidebarNewMenu } from "./sidebar-new-menu";
import { SidebarSeparator } from "./sidebar-separator";

export interface SidebarFooterProps {
  handleOpenProject: () => void;
  handleImportSession: () => void;
  handleSettings: () => void;
  labels: {
    addProject: string;
    hosts: string;
    importSession: string;
    settings: string;
    searchHosts: string;
    usage: string;
  };
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
  onBeforeNavigate?: () => void;
  top?: boolean;
}

export function SidebarFooter(props: SidebarFooterProps) {
  const compact = useIsCompactFormFactor();
  const controls = <SidebarFooterControls {...props} />;
  const actions = <SidebarFooterActions {...props} />;
  return (
    <UsageSidebarRoot>
      <View
        style={props.top ? styles.topContainer : styles.footerContainer}
        testID="sidebar-footer"
      >
        {props.top ? null : <SidebarFooterRows onBeforeNavigate={props.onBeforeNavigate} />}
        <View
          style={[styles.sidebarFooter, compact && styles.sidebarFooterCompact]}
          testID="sidebar-footer-bottom-line"
        >
          {compact ? (
            <>
              {controls}
              {actions}
            </>
          ) : (
            <>
              {actions}
              {controls}
            </>
          )}
        </View>
        {props.top ? <SidebarFooterRows onBeforeNavigate={props.onBeforeNavigate} /> : null}
      </View>
    </UsageSidebarRoot>
  );
}

function SidebarFooterActions({
  handleOpenProject,
  handleImportSession,
  labels,
}: SidebarFooterProps) {
  const newAgentKeys = useShortcutKeys("new-agent");
  const { items } = useSidebarFooterItems();
  const compact = useIsCompactFormFactor();
  const finePointer = useHasFinePointer();
  const touchTarget = compact || !finePointer;
  const actions = items.filter((item) => item.visible && item.group === "actions");
  // A phone keeps every footer action on one line: search shrinks to its icon instead of wrapping.
  const actionWidths: Record<string, number> = {
    search: compact ? MIN_TOUCH_TARGET_SIZE : FOOTER_SEARCH_MIN_WIDTH,
    new: touchTarget ? MIN_TOUCH_TARGET_SIZE : buttonControlHeight.sm,
    "add-project": touchTarget ? MIN_TOUCH_TARGET_SIZE : buttonControlHeight.xs,
  };
  const actionMinWidth =
    actions.reduce((width, item) => width + actionWidths[item.key], 0) +
    Math.max(0, actions.length - 1) * SPACING[touchTarget ? 2 : 1];

  const actionNodes = actions.map((item) => {
    if (item.key === "new") {
      return (
        <SidebarNewMenu
          key={item.key}
          onAddProject={handleOpenProject}
          onImportSession={handleImportSession}
        />
      );
    }
    if (item.key === "search") {
      return <FooterSearchField key={item.key} />;
    }
    return (
      <FooterIconButton
        key={item.key}
        onPress={handleOpenProject}
        label={labels.addProject}
        shortcutKeys={newAgentKeys}
        icon={FolderPlus}
        testID="sidebar-add-project"
      />
    );
  });
  return (
    <View style={styles.footerActions(actionMinWidth, touchTarget)}>
      {compact ? actionNodes.toReversed() : actionNodes}
    </View>
  );
}

function SidebarFooterControls({
  handleSettings,
  handleAddHost,
  handleOpenHostSettings,
  handleImportSession,
  labels,
}: SidebarFooterProps) {
  const settingsKeys = useShortcutKeys("toggle-settings");
  const { items } = useSidebarFooterItems();
  const compact = useIsCompactFormFactor();
  const controlNodes = [
    ...items
      .filter((item) => item.visible && item.group === "controls")
      .map((item) => {
        if (item.key === "hosts") {
          return (
            <SidebarHostPicker
              key={item.key}
              label={labels.hosts}
              onAddHost={handleAddHost}
              onOpenHostSettings={handleOpenHostSettings}
            />
          );
        }
        if (item.key === "usage-icon") {
          return <SidebarUsageIcon key={item.key} label={labels.usage} />;
        }
        return (
          <FooterIconButton
            key={item.key}
            onPress={handleImportSession}
            testID="sidebar-import-session"
            label={labels.importSession}
            icon={Import}
          />
        );
      }),
    <SidebarHelpMenu key="help" />,
    <FooterIconButton
      key="settings"
      onPress={handleSettings}
      testID="sidebar-settings"
      label={labels.settings}
      icon={Settings}
      shortcutKeys={settingsKeys}
    />,
  ];
  return (
    <View style={[styles.footerIconRow, compact && styles.footerIconRowCompact]}>
      {compact ? controlNodes.toReversed() : controlNodes}
    </View>
  );
}

/**
 * The footer rows in the user's `sidebarFooterItems` order: the Usage item and plugin rows. The
 * Usage item is left out while it has no summary to show.
 */
function SidebarFooterRows({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const { items } = useSidebarNavItems("footer");
  const hasUsageSummary = useHasUsageSummary();
  const rowsRef = useRef<View | null>(null);
  const visibleItems = items.filter(
    (item) => item.visible && (item.kind === "plugin" || hasUsageSummary),
  );
  if (visibleItems.length === 0) return null;
  return (
    <>
      <View ref={rowsRef} collapsable={false} style={styles.footerRows}>
        {visibleItems.map((item) =>
          item.kind === "plugin" ? (
            <PluginSidebarItem
              key={item.key}
              group={item.group}
              section="footer"
              fallbackAnchorRef={rowsRef}
              onBeforeNavigate={onBeforeNavigate}
            />
          ) : (
            <UsageSidebarItem key={item.key} />
          ),
        )}
      </View>
      <SidebarSeparator testID="sidebar-footer-separator" />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  topContainer: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  footerContainer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  sidebarFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[3],
  },
  sidebarFooterCompact: {
    flexWrap: "nowrap",
  },
  footerIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
    marginLeft: "auto",
  },
  // Touch targets are already 48pt wide; their glyphs need no extra gap. The row leads the line.
  footerIconRowCompact: {
    gap: 0,
    marginLeft: 0,
  },
  footerActions: (minWidth: number, touchTarget: boolean) => ({
    flex: 1,
    minWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING[touchTarget ? 2 : 1],
  }),
  // Usage and plugin rows sit above the footer's icon line, spaced like the header nav rows.
  footerRows: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    gap: 2,
  },
}));
