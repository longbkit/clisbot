import type { Rect } from "@/components/ui/menu/menu-anchor";
import { useLimitedSidebarGroup } from "@/components/sidebar/use-limited-sidebar-group";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import { Text } from "react-native";
import { useState, useMemo, useCallback } from "react";
import { usePathname, useRouter } from "expo-router";
import { Bot, Folder, Hash, Pin, MessageSquare } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { PinOptionsMenu } from "./pin-options";
import { pinAction } from "../chat/chat-resource-actions";

const UNPIN_ACTIONS = [pinAction(true)];
import { BotsSectionHeader, useSectionCollapsed } from "./section-header";
import { BotsSidebarRow } from "./row";
import { usePinnedRows, type PinRow } from "./use-pinned-rows";
const Icons = {
  bot: withUnistyles(Bot),
  chat: withUnistyles(Hash),
  project: withUnistyles(Folder),
  session: withUnistyles(MessageSquare),
  workspace: withUnistyles(Pin),
};

export function FusionPinnedSection({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const { rows, error } = usePinnedRows(onBeforeNavigate);
  const { visibleItems, expanded, canToggle, toggleExpanded } = useLimitedSidebarGroup(rows);
  const [menu, setMenu] = useState<(PinRow & { anchor: Rect }) | null>(null);
  const pathname = usePathname();
  const [collapsed, toggleCollapsed] = useSectionCollapsed("pinned");
  const closeMenu = useCallback(() => setMenu(null), []);
  const removePin = useCallback(() => {
    menu?.remove();
    closeMenu();
  }, [menu, closeMenu]);
  return (
    <>
      <BotsSectionHeader
        label="Pinned"
        testID="sidebar-unified-pinned"
        collapsed={collapsed}
        onToggle={toggleCollapsed}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {!collapsed
        ? visibleItems.map((row) => (
            <PinnedRow
              key={row.key}
              row={row}
              selected={row.route === pathname}
              onBeforeNavigate={onBeforeNavigate}
              onOpenMenu={setMenu}
            />
          ))
        : null}
      {!collapsed && canToggle ? (
        <SidebarGroupToggleRow
          expanded={expanded}
          onPress={toggleExpanded}
          testID="sidebar-unified-pinned-show-more"
        />
      ) : null}
      <PinOptionsMenu
        anchor={menu?.anchor}
        visible={menu !== null}
        title={menu?.title ?? "Pinned item"}
        actions={UNPIN_ACTIONS}
        onSelect={removePin}
        onClose={closeMenu}
      />
    </>
  );
}

const pinColor = (theme: import("@/styles/theme").Theme) => ({
  color: theme.colors.foregroundMuted,
});
function PinnedRow({
  row,
  selected,
  onBeforeNavigate,
  onOpenMenu,
}: {
  row: PinRow;
  selected: boolean;
  onBeforeNavigate?: () => void;
  onOpenMenu: (row: PinRow & { anchor: Rect }) => void;
}) {
  const router = useRouter();
  const Icon = Icons[row.kind];
  const leading = useMemo(() => <Icon size={16} uniProps={pinColor} />, [Icon]);
  const open = useCallback(() => {
    if (row.open) row.open();
    else {
      onBeforeNavigate?.();
      router.push(row.route as import("expo-router").Href);
    }
  }, [row, onBeforeNavigate, router]);
  const menu = useCallback((anchor: Rect) => onOpenMenu({ ...row, anchor }), [row, onOpenMenu]);
  return (
    <BotsSidebarRow
      testID={`sidebar-pin-${row.key}`}
      title={row.title}
      selected={selected}
      leading={leading}
      onPress={open}
      onOpenMenu={menu}
      menuLabel="Pinned item options"
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  error: { color: theme.colors.foregroundMuted, padding: 8, fontSize: theme.fontSize.sm },
}));
