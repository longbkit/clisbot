import { useCallback, useMemo, useRef, type ComponentType, type ReactNode } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { PressHighlight } from "@/components/ui/press-highlight";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Blocks,
  CalendarClock,
  CircleGauge,
  CircleHelp,
  FolderKanban,
  Home,
  ListTodo,
  MessageSquare,
  Puzzle,
  Server,
  Settings,
  type LucideIcon,
} from "lucide-react-native";
import { ConnectionStatusDot } from "@/components/host-status-dot";
import {
  SidebarHostPicker,
  type SidebarHostPickerTrigger,
} from "@/components/sidebar/sidebar-footer-controls";
import { SidebarHelpMenu } from "@/components/sidebar/sidebar-help-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MenuTriggerState } from "@/components/ui/menu/menu-root";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { openHostOverview } from "@/navigation/settings-navigation";
import { pluginIconComponent } from "@/plugins/icons";
import { PluginSidebarItem } from "@/plugins/sidebar-items";
import { UsageSidebarRoot, useOpenSidebarUsage } from "@/usage";
import { buildSettingsAddHostRoute } from "@/utils/host-routes";
import { useOwnsWindowChromeCorner, WindowChromeSafeArea } from "@/utils/desktop-window";
import type { Theme } from "@/styles/theme";
import { useNavigationActivity } from "./activity";
import { useHostsStatus } from "./hosts-status";
import type {
  BuiltinSection,
  BuiltinSectionId,
  NavigationSection,
  PluginSection,
} from "./sections";
import { useNavigationSections } from "./use-navigation-sections";
import { useActiveSection, useOpenRailSection } from "./use-open-section";

export const RAIL_WIDTH = 76;

export const SECTION_ICONS: Record<BuiltinSectionId, LucideIcon> = {
  home: Home,
  chats: MessageSquare,
  work: FolderKanban,
  schedules: CalendarClock,
  tasks: ListTodo,
  connectors: Blocks,
  usage: CircleGauge,
  hosts: Server,
  help: CircleHelp,
  settings: Settings,
};

/** The desktop primary navigation (brief C1): where you are, one registry entry per item. */
export function NavigationRail() {
  const { railPrimary, railBottom } = useNavigationSections();
  const ownsTopLeft = useOwnsWindowChromeCorner("top-left");
  return (
    <UsageSidebarRoot>
      <View style={styles.rail} testID="navigation-rail">
        <View style={ownsTopLeft ? styles.chromeSpacer : styles.dragArea}>
          <TitlebarDragRegion />
        </View>
        <WindowChromeSafeArea placement="below" />
        <View style={styles.group}>
          {railPrimary.map((section) => (
            <RailEntry key={section.key} section={section} />
          ))}
        </View>
        <View style={styles.spacer} />
        <View style={styles.group}>
          {railBottom.map((section) => (
            <RailEntry key={section.key} section={section} />
          ))}
        </View>
      </View>
    </UsageSidebarRoot>
  );
}

function RailEntry({ section }: { section: NavigationSection }) {
  if (section.kind === "plugin") return <RailPluginItem section={section} />;
  if (section.id === "hosts") return <RailHosts section={section} />;
  if (section.id === "help") return <RailHelp section={section} />;
  if (section.id === "usage") return <RailUsage section={section} />;
  return <RailRoute section={section} />;
}

function useSectionLabel(section: BuiltinSection) {
  const { t } = useTranslation();
  return t(section.labelKey);
}

function RailRoute({ section }: { section: BuiltinSection }) {
  const label = useSectionLabel(section);
  const active = useActiveSection() === section.id;
  const open = useOpenRailSection();
  const press = useCallback(() => open(section), [open, section]);
  const { badge } = useNavigationActivity();
  const { t } = useTranslation();
  let trailing: ReactNode = null;
  if (section.id === "home" && badge > 0)
    trailing = <StatusBadge label={String(badge)} variant="warning" size="xs" />;
  if (section.status === "preview") trailing = <StatusBadge label="dev" size="xs" />;
  const tooltip = section.status === "preview" ? `${label} · ${t("navigation.preview")}` : label;
  return (
    <RailButton
      Icon={SECTION_ICONS[section.id]}
      label={label}
      tooltip={tooltip}
      active={active}
      onPress={press}
      badge={trailing}
      testID={`navigation-rail-${section.id}`}
    />
  );
}

function RailUsage({ section }: { section: BuiltinSection }) {
  const label = useSectionLabel(section);
  const openUsage = useOpenSidebarUsage();
  return (
    <RailButton
      Icon={CircleGauge}
      label={label}
      onPress={openUsage}
      testID="navigation-rail-usage"
    />
  );
}

function RailHosts({ section }: { section: BuiltinSection }) {
  const label = useSectionLabel(section);
  const router = useRouter();
  const status = useHostsStatus();
  const addHost = useCallback(() => router.push(buildSettingsAddHostRoute(Date.now())), [router]);
  const dot = useMemo(() => <ConnectionStatusDot status={status} small />, [status]);
  const renderTrigger = useCallback(
    (trigger: SidebarHostPickerTrigger) => (
      <View ref={trigger.ref} collapsable={false}>
        <RailButton
          Icon={Server}
          label={label}
          tooltip={trigger.label}
          onPress={trigger.onPress}
          dot={dot}
          testID="sidebar-hosts-trigger"
        />
      </View>
    ),
    [dot, label],
  );
  return (
    <SidebarHostPicker
      label={label}
      onAddHost={addHost}
      onOpenHostSettings={openHostOverview}
      renderTrigger={renderTrigger}
    />
  );
}

function RailHelp({ section }: { section: BuiltinSection }) {
  const label = useSectionLabel(section);
  const trigger = useMemo(
    () => ({
      style: railTriggerStyle,
      side: "right" as const,
      align: "end" as const,
      render: (state: MenuTriggerState) => (
        <RailContent Icon={CircleHelp} label={label} active={state.open} hovered={state.hovered} />
      ),
    }),
    [label],
  );
  return <SidebarHelpMenu trigger={trigger} />;
}

/**
 * A plugin's sidebar item, drawn by the plugin itself, opens from its rail entry. A legacy item
 * brings its own icon; others share the plugin glyph.
 */
function RailPluginItem({ section }: { section: PluginSection }) {
  const anchor = useRef<View | null>(null);
  const Icon = section.group.kind === "legacy" ? pluginIconComponent(section.group.icon) : Puzzle;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={railTriggerStyle}
        accessibilityRole="button"
        accessibilityLabel={section.group.title}
        testID={`navigation-rail-${section.key}`}
      >
        {(state: MenuTriggerState) => (
          <RailContent
            Icon={Icon as LucideIcon}
            label={section.group.title}
            active={state.open}
            hovered={state.hovered}
          />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" width={260}>
        <View ref={anchor} collapsable={false} style={styles.pluginMenu}>
          <PluginSidebarItem
            group={section.group}
            section={section.rail === "primary" ? "header" : "footer"}
            fallbackAnchorRef={anchor}
          />
        </View>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function railTriggerStyle({ pressed }: MenuTriggerState) {
  return [styles.item, pressed && styles.itemPressed];
}

function RailButton({
  Icon,
  label,
  tooltip,
  active = false,
  onPress,
  badge,
  dot,
  testID,
}: {
  Icon: LucideIcon;
  label: string;
  tooltip?: string;
  active?: boolean;
  onPress: () => void;
  badge?: ReactNode;
  dot?: ReactNode;
  testID: string;
}) {
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.item, pressed && styles.itemPressed],
    [],
  );
  const state = useMemo(() => ({ selected: active }), [active]);
  return (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>
        <PressHighlight
          accessibilityRole="tab"
          accessibilityLabel={tooltip ?? label}
          accessibilityState={state}
          aria-selected={active}
          onPress={onPress}
          style={style}
          testID={testID}
        >
          {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
            <RailContent
              Icon={Icon}
              label={label}
              active={active}
              hovered={Boolean(hovered)}
              badge={badge}
              dot={dot}
            />
          )}
        </PressHighlight>
      </TooltipTrigger>
      <TooltipContent side="right" align="center" offset={6}>
        <Text style={styles.tooltip}>{tooltip ?? label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function RailContent({
  Icon,
  label,
  active,
  hovered,
  badge,
  dot,
}: {
  Icon: LucideIcon;
  label: string;
  active: boolean;
  hovered: boolean;
  badge?: ReactNode;
  dot?: ReactNode;
}) {
  return (
    <>
      <View style={[styles.glyph, hovered && styles.glyphHovered, active && styles.glyphActive]}>
        <ThemedIcon Icon={Icon} uniProps={active || hovered ? strongColor : mutedColor} />
        {dot ? <View style={styles.dot}>{dot}</View> : null}
        {badge ? <View style={styles.badge}>{badge}</View> : null}
      </View>
      <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
}

function Glyph({
  Icon,
  color,
}: {
  Icon: ComponentType<{ size: number; color?: string; strokeWidth?: number }>;
  color?: string;
}) {
  return <Icon size={20} color={color} strokeWidth={1.75} />;
}
const ThemedIcon = withUnistyles(Glyph);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const strongColor = (theme: Theme) => ({ color: theme.colors.foreground });

const styles = StyleSheet.create((theme) => ({
  rail: {
    width: RAIL_WIDTH,
    flex: 1,
    backgroundColor: theme.colors.surfaceSidebar,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    paddingBottom: theme.spacing[3],
  },
  dragArea: { height: theme.spacing[3] },
  chromeSpacer: { height: 0 },
  group: { gap: theme.spacing[1], alignItems: "stretch", flexShrink: 1 },
  spacer: { flex: 1 },
  item: {
    alignItems: "center",
    gap: 2,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    minHeight: 52,
  },
  itemPressed: { opacity: 0.85 },
  glyph: {
    width: 40,
    height: 30,
    borderRadius: theme.borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  glyphHovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  glyphActive: { backgroundColor: theme.colors.surfaceSidebarSelected, ...theme.shadow.raised },
  label: {
    maxWidth: RAIL_WIDTH - theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  labelActive: { color: theme.colors.foreground, fontWeight: theme.fontWeight.medium },
  badge: { position: "absolute", top: -6, right: -10 },
  dot: { position: "absolute", top: 3, right: 6 },
  tooltip: { color: theme.colors.popoverForeground, fontSize: theme.fontSize.sm },
  pluginMenu: { padding: theme.spacing[1] },
}));
