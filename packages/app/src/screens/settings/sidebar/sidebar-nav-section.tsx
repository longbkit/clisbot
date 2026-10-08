import { useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ArrowDown,
  ArrowUp,
  Blocks,
  CalendarClock,
  CircleHelp,
  FolderPlus,
  Gauge,
  History,
  Import,
  Plus,
  Search,
  Server,
  Settings,
  type LucideIcon,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Shortcut } from "@/components/ui/shortcut";
import { Switch } from "@/components/ui/switch";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import {
  builtinSidebarNavLabelKey,
  builtinSidebarNavShortcutAction,
  type BuiltinSidebarItemId,
  type SidebarNavItem,
  type SidebarSection,
} from "@/sidebar-nav/model";
import { resolvePluginIcon } from "@/plugins/icons";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import {
  canMoveSidebarFooterItem,
  sidebarFooterShortcutAction,
  type SidebarFooterId,
} from "@/sidebar-nav/footer-model";
import { useSidebarFooterItems } from "@/sidebar-nav/use-sidebar-footer-items";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);

const moveUpIcon = <ThemedArrowUp size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const moveDownIcon = <ThemedArrowDown size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;

const BUILTIN_ICONS: Record<BuiltinSidebarItemId, LucideIcon> = {
  "new-workspace": Plus,
  "add-project": FolderPlus,
  history: History,
  search: Search,
  schedules: CalendarClock,
  usage: Gauge,
};

const FOOTER_ICONS: Record<SidebarFooterId, LucideIcon> = {
  new: Plus,
  "add-project": FolderPlus,
  search: Search,
  "usage-icon": Gauge,
  hosts: Server,
  "import-session": Import,
  help: CircleHelp,
  settings: Settings,
};
/** Plugin items register no icon, so they share this one; a legacy `addSidebarItem` keeps its own. */
const PLUGIN_ICON = Blocks;

function NavIcon({ Icon, color = "" }: { Icon: LucideIcon; color?: string }) {
  return <Icon size={ICON_SIZE.md} color={color} />;
}

const ThemedNavIcon = withUnistyles(NavIcon);

function navItemIcon(item: SidebarNavItem): LucideIcon {
  if (item.kind === "builtin") return BUILTIN_ICONS[item.id];
  return item.group.kind === "legacy" ? resolvePluginIcon(item.group.icon) : PLUGIN_ICON;
}

function navItemLabel(t: TFunction, item: SidebarNavItem): string {
  return item.kind === "builtin" ? t(builtinSidebarNavLabelKey(item.id)) : item.group.title;
}

/** Own component so the row can stay hook-free about which items have a shortcut. */
function NavItemShortcut({ action }: { action: string | null }): ReactElement | null {
  const chord = useShortcutKeys(action);
  return chord ? <Shortcut chord={chord} /> : null;
}

interface SidebarNavRowProps {
  item: { key: string; visible: boolean };
  label: string;
  Icon: LucideIcon;
  shortcutAction: string | null;
  testIDPrefix: string;
  isFirst: boolean;
  isLast: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  locked?: boolean;
  onMove: (key: string, direction: "up" | "down") => void;
  onSetVisible: (key: string, visible: boolean) => void;
}

function SidebarNavRow({
  item,
  label,
  Icon,
  shortcutAction,
  testIDPrefix,
  isFirst,
  isLast,
  canMoveUp = !isFirst,
  canMoveDown = !isLast,
  locked = false,
  onMove,
  onSetVisible,
}: SidebarNavRowProps): ReactElement {
  const { t } = useTranslation();

  const handleMoveUp = useCallback(() => onMove(item.key, "up"), [item.key, onMove]);
  const handleMoveDown = useCallback(() => onMove(item.key, "down"), [item.key, onMove]);
  const handleVisibleChange = useCallback(
    (visible: boolean) => onSetVisible(item.key, visible),
    [item.key, onSetVisible],
  );

  const rowStyle = useMemo(
    () => [settingsStyles.row, isFirst ? null : settingsStyles.rowBorder, styles.row],
    [isFirst],
  );

  return (
    <View style={rowStyle} testID={`${testIDPrefix}-item-${item.key}`}>
      <View style={styles.rowMain}>
        <ThemedNavIcon Icon={Icon} uniProps={mutedColorMapping} />
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {label}
        </Text>
        <NavItemShortcut action={shortcutAction} />
      </View>
      <View style={styles.rowActions}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveUpIcon}
          onPress={handleMoveUp}
          disabled={!canMoveUp || locked}
          accessibilityLabel={t("settings.appearance.sidebar.moveUp")}
          testID={`${testIDPrefix}-move-up-${item.key}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveDownIcon}
          onPress={handleMoveDown}
          disabled={!canMoveDown || locked}
          accessibilityLabel={t("settings.appearance.sidebar.moveDown")}
          testID={`${testIDPrefix}-move-down-${item.key}`}
        />
        <Switch
          value={item.visible}
          onValueChange={handleVisibleChange}
          disabled={locked}
          accessibilityLabel={label}
          testID={`${testIDPrefix}-toggle-${item.key}`}
        />
      </View>
    </View>
  );
}

const SECTION_COPY = {
  header: {
    title: "settings.appearance.sidebar.header.title",
    info: "settings.appearance.sidebar.header.description",
  },
  footer: {
    title: "settings.appearance.sidebar.footer.title",
    info: "settings.appearance.sidebar.footer.description",
  },
} as const satisfies Record<SidebarSection, { title: string; info: string }>;

function SidebarItemsCard({ section }: { section: SidebarSection }): ReactElement {
  const { t } = useTranslation();
  const { items, setVisible, move } = useSidebarNavItems(section);

  return (
    <SettingsSection
      title={t(SECTION_COPY[section].title)}
      info={t(SECTION_COPY[section].info)}
      testID={`sidebar-nav-section-${section}`}
    >
      <View style={settingsStyles.card}>
        {items.map((item, index) => (
          <SidebarNavRow
            key={item.key}
            item={item}
            label={navItemLabel(t, item)}
            Icon={navItemIcon(item)}
            shortcutAction={
              item.kind === "builtin" ? builtinSidebarNavShortcutAction(item.id) : null
            }
            testIDPrefix={section === "header" ? "sidebar-nav" : "sidebar-nav-footer"}
            isFirst={index === 0}
            isLast={index === items.length - 1}
            onMove={move}
            onSetVisible={setVisible}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

/** Clisbot's bottom bar: actions on the left, controls on the right, Help and Settings fixed. */
function SidebarBottomBarCard(): ReactElement {
  const { t } = useTranslation();
  const footer = useSidebarFooterItems();
  return (
    <SettingsSection
      title={t("settings.appearance.sidebar.bottomTitle")}
      info={t("settings.appearance.sidebar.bottomDescription")}
      testID="sidebar-footer-section"
    >
      <View style={settingsStyles.card}>
        {footer.items.map((item, index) => (
          <SidebarNavRow
            key={item.key}
            item={item}
            label={t(item.labelKey)}
            Icon={FOOTER_ICONS[item.key]}
            shortcutAction={sidebarFooterShortcutAction(item.key)}
            testIDPrefix="sidebar-footer"
            isFirst={index === 0}
            isLast={index === footer.items.length - 1}
            canMoveUp={canMoveSidebarFooterItem(footer.items, item.key, "up")}
            canMoveDown={canMoveSidebarFooterItem(footer.items, item.key, "down")}
            locked={item.group === "fixed"}
            onMove={footer.move}
            onSetVisible={footer.setVisible}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

/** Settings > Sidebar: the header and footer row cards, then Clisbot's bottom bar. */
export function SidebarNavSection(): ReactElement {
  return (
    <>
      <SidebarItemsCard section="header" />
      <SidebarItemsCard section="footer" />
      <SidebarBottomBarCard />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    gap: theme.spacing[2],
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
