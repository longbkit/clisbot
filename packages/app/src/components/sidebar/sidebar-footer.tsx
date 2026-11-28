import { useContainerWidth } from "@/hooks/use-container-width";
import type { SidebarFooterItem } from "@/sidebar-nav/footer-model";
import {
  resolveSidebarFooterLayout,
  type SidebarFooterAction,
} from "@/components/sidebar-footer-layout";
import { SidebarFooterOverflowMenu } from "./sidebar-footer-overflow-menu";
import { SPACING } from "@/styles/theme";
import {
  buttonControlHeight,
  MIN_TOUCH_TARGET_SIZE,
  TOOLBAR_CONTROL_SIZES,
} from "@/components/ui/control-geometry";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePointerCapabilities } from "@/hooks/pointer-capabilities";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { PluginSidebarItem } from "@/plugins/sidebar-items";
import { useSidebarFooterItems } from "@/sidebar-nav/use-sidebar-footer-items";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { UsageSidebarItem, UsageSidebarRoot, useUsageSummary } from "@/usage";
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

function footerAction(item: SidebarFooterItem): SidebarFooterAction | "new" {
  return item.key === "usage-icon" ? "usage" : item.key;
}

function useFooterLayout() {
  const compact = useIsCompactFormFactor();
  const { finePointer } = usePointerCapabilities();
  const { items } = useSidebarFooterItems();
  const { width, onLayout } = useContainerWidth();
  const touch = compact || !finePointer;
  const size = touch ? MIN_TOUCH_TARGET_SIZE : TOOLBAR_CONTROL_SIZES.pointer;
  const visible = items.filter((item) => item.visible);
  const hasNew = visible.some((item) => item.key === "new");
  const newSize = touch ? MIN_TOUCH_TARGET_SIZE : buttonControlHeight.sm;
  const hasSearchField = !compact && visible.some((item) => item.key === "search");
  const padding = SPACING[2];
  // Keep the full search field and spacing wherever they fit. In a narrower row every
  // action is square, with New kept reachable as the entry point for all its creation flows.
  const fullWidth =
    padding * 2 +
    size * visible.length +
    (hasNew ? newSize - size : 0) +
    padding * (visible.length - 1) +
    (hasSearchField ? FOOTER_SEARCH_MIN_WIDTH - size : 0);
  const packed = width < fullWidth;
  const actions = visible.map(footerAction).filter((key) => key !== "new");
  const layout = resolveSidebarFooterLayout({
    rowWidth: width - (hasNew ? newSize : 0),
    rowPadding: padding,
    controlSize: size,
    actions,
  });
  const inline = packed
    ? visible.filter((item) => {
        const key = footerAction(item);
        return key === "new" || layout.inline.includes(key);
      })
    : visible;
  return { compact, packed, inline, overflow: packed ? layout.overflow : [], width, onLayout };
}

export function SidebarFooter(props: SidebarFooterProps) {
  const { compact, packed, inline, overflow, width, onLayout } = useFooterLayout();
  const controls = (
    <SidebarFooterControls {...props} items={inline} overflow={overflow} packed={packed} />
  );
  const actions = <SidebarFooterActions {...props} items={inline} packed={packed} />;
  return (
    <UsageSidebarRoot>
      <View
        style={props.top ? styles.topContainer : styles.footerContainer}
        testID="sidebar-footer"
      >
        {props.top ? null : <SidebarFooterRows onBeforeNavigate={props.onBeforeNavigate} />}
        <View
          onLayout={onLayout}
          style={[
            styles.sidebarFooter,
            compact && styles.sidebarFooterCompact,
            packed && styles.packed,
          ]}
          testID="sidebar-footer-bottom-line"
        >
          {width > 0 &&
            (compact ? (
              <>
                {controls}
                {actions}
              </>
            ) : (
              <>
                {actions}
                {controls}
              </>
            ))}
        </View>
        {props.top ? <SidebarFooterRows stable onBeforeNavigate={props.onBeforeNavigate} /> : null}
      </View>
    </UsageSidebarRoot>
  );
}

function SidebarFooterActions({
  handleOpenProject,
  handleImportSession,
  labels,
  items,
  packed,
}: SidebarFooterProps & { items: SidebarFooterItem[]; packed: boolean }) {
  const newAgentKeys = useShortcutKeys("new-agent");
  const compact = useIsCompactFormFactor();
  const { finePointer } = usePointerCapabilities();
  const touchTarget = compact || !finePointer;
  const actions = items.filter((item) => item.visible && item.group === "actions");
  // A phone keeps every footer action on one line: search shrinks to its icon instead of wrapping.
  const packedSize = touchTarget ? MIN_TOUCH_TARGET_SIZE : TOOLBAR_CONTROL_SIZES.pointer;
  const actionWidths: Record<string, number> = {
    search: packed || compact ? packedSize : FOOTER_SEARCH_MIN_WIDTH,
    new: touchTarget ? MIN_TOUCH_TARGET_SIZE : buttonControlHeight.sm,
    "add-project": packedSize,
  };
  const actionMinWidth =
    actions.reduce((width, item) => width + actionWidths[item.key], 0) +
    Math.max(0, actions.length - 1) * (packed ? 0 : SPACING[touchTarget ? 2 : 1]);

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
      return <FooterSearchField key={item.key} iconOnly={packed} />;
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
    <View style={[styles.footerActions(actionMinWidth, touchTarget), packed && styles.packed]}>
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
  items,
  overflow,
  packed,
  handleOpenProject,
}: SidebarFooterProps & {
  items: SidebarFooterItem[];
  overflow: SidebarFooterAction[];
  packed: boolean;
}) {
  const settingsKeys = useShortcutKeys("toggle-settings");
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
    items.some((item) => item.key === "help") && <SidebarHelpMenu key="help" />,
    overflow.length > 0 && (
      <SidebarFooterOverflowMenu
        key="overflow"
        actions={overflow}
        labels={labels}
        onAddProject={handleOpenProject}
        onImportSession={handleImportSession}
        onSettings={handleSettings}
        onAddHost={handleAddHost}
        onOpenHostSettings={handleOpenHostSettings}
      />
    ),
    items.some((item) => item.key === "settings") && (
      <FooterIconButton
        key="settings"
        onPress={handleSettings}
        testID="sidebar-settings"
        label={labels.settings}
        icon={Settings}
        shortcutKeys={settingsKeys}
      />
    ),
  ];
  return (
    <View
      style={[
        styles.footerIconRow,
        compact && styles.footerIconRowCompact,
        packed && styles.packed,
      ]}
    >
      {compact ? controlNodes.toReversed() : controlNodes}
    </View>
  );
}

/**
 * The footer rows in the user's `sidebarFooterItems` order: the Usage item and plugin rows. The
 * Desktop omits Usage without a summary. The compact top toolbar reserves its configured row
 * and keeps the Usage action available before reports arrive. Plugin contributions keep their own height.
 */
function SidebarFooterRows({
  onBeforeNavigate,
  stable = false,
}: {
  onBeforeNavigate?: () => void;
  stable?: boolean;
}) {
  const { items } = useSidebarNavItems("footer");
  // Read once here and handed to the item, as upstream lifts the summary to its caller.
  const usageSummary = useUsageSummary();
  const hasUsageSummary = usageSummary.length > 0;
  const rowsRef = useRef<View | null>(null);
  const visibleItems = items.filter(
    (item) => item.visible && (item.kind === "plugin" || stable || hasUsageSummary),
  );
  if (visibleItems.length === 0) return null;
  return (
    <>
      <View ref={rowsRef} collapsable={false} style={styles.footerRows}>
        {visibleItems.map((item) => (
          <View key={item.key} style={stable && item.kind !== "plugin" && styles.stableUsageRow}>
            {item.kind === "plugin" ? (
              <PluginSidebarItem
                key={item.key}
                group={item.group}
                section="footer"
                fallbackAnchorRef={rowsRef}
                onBeforeNavigate={onBeforeNavigate}
              />
            ) : (
              <UsageSidebarItem key={item.key} sources={usageSummary} reserveSpace={stable} />
            )}
          </View>
        ))}
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
  packed: { gap: 0 },
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
  stableUsageRow: { height: MIN_TOUCH_TARGET_SIZE, justifyContent: "center" },
  footerRows: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    gap: 2,
  },
}));
