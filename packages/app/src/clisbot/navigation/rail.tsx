import {
  useCallback,
  useMemo,
  useRef,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from "react";
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
  PenTool,
  Puzzle,
  Server,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react-native";
import {
  SidebarHostPicker,
  type SidebarHostPickerTrigger,
} from "@/components/sidebar/sidebar-footer-controls";
import { SidebarHelpMenu } from "@/components/sidebar/sidebar-help-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  useDropdownMenuClose,
} from "@/components/ui/dropdown-menu";
import type { MenuTriggerState } from "@/components/ui/menu/menu-root";
import { ConnectionStatusDot } from "@/components/host-status-dot";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { openHostOverview } from "@/navigation/settings-navigation";
import { pluginIconComponent } from "@/plugins/icons";
import { PluginSidebarItem } from "@/plugins/sidebar-items";
import { UsageSidebarRoot, useOpenSidebarUsage } from "@/usage";
import { buildSettingsAddHostRoute } from "@/utils/host-routes";
import { useOwnsWindowChromeCorner, WindowChromeSafeArea } from "@/utils/desktop-window";
import { ICON_SIZE, ICON_STROKE_WIDTH, type Theme } from "@/styles/theme";
import { CONTROL_HEIGHTS, MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";
import { useNavigationActivity } from "./activity";
import { SECTION_MENU_WIDTH } from "./section-header";
import { useHostsStatus } from "./hosts-status";
import { useHostFilter } from "./host-filter";
import { useCurrentSession } from "./opened-session";
import { SessionQuota } from "./session-quota";
import { RAIL_MICRO_TEXT } from "./rail-text";
import { hostFilterLabel } from "./host-filter-chip";
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
  design: PenTool,
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

/** Usage; while a session is on screen, that session's quota under the label. */
function RailUsage({ section }: { section: BuiltinSection }) {
  const label = useSectionLabel(section);
  const openUsage = useOpenSidebarUsage();
  const session = useCurrentSession();
  const caption = useMemo(
    () =>
      session ? (
        <SessionQuota
          key={`${session.serverId}:${session.agentId}`}
          session={session}
          layout="rail"
        />
      ) : undefined,
    [session],
  );
  return (
    <RailButton
      Icon={CircleGauge}
      label={label}
      caption={caption}
      onPress={openUsage}
      testID="navigation-rail-usage"
    />
  );
}

function RailHosts({ section }: { section: BuiltinSection }) {
  const label = useSectionLabel(section);
  const router = useRouter();
  const status = useHostsStatus();
  const filter = useHostFilter();
  const { t } = useTranslation();
  // The tooltip and the Hosts picker say how many are online; the icon only carries the dot.
  const countsLabel = t("navigation.hostFilter.online", {
    online: filter.online,
    total: filter.total,
  });
  const addHost = useCallback(() => router.push(buildSettingsAddHostRoute(Date.now())), [router]);
  const dot = useMemo(() => <ConnectionStatusDot status={status} small />, [status]);
  const renderTrigger = useCallback(
    (trigger: SidebarHostPickerTrigger) => (
      <View ref={trigger.ref} collapsable={false}>
        <RailButton
          Icon={Server}
          label={label}
          tooltip={`${trigger.label} · ${countsLabel}`}
          onPress={trigger.onPress}
          dot={dot}
          testID="sidebar-hosts-trigger"
        />
      </View>
    ),
    [countsLabel, dot, label],
  );
  return (
    <>
      <SidebarHostPicker
        label={label}
        onAddHost={addHost}
        onOpenHostSettings={openHostOverview}
        renderTrigger={renderTrigger}
      />
      {filter.active ? <RailHostFilterTag /> : null}
    </>
  );
}

/**
 * The Host filter in force, on the rail where it is set (Owner, 2026-10-26): it filters every
 * list, so it stays in sight; pressing it clears the filter.
 */
function RailHostFilterTag() {
  const { t } = useTranslation();
  const filter = useHostFilter();
  const name = hostFilterLabel(filter, t);
  const clearLabel = `${t("navigation.hostFilter.clear")}: ${name}`;
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <PressHighlight
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
          onPress={filter.clear}
          style={styles.hostTag}
          testID="rail-host-filter-tag"
        >
          <Text style={styles.hostTagLabel} numberOfLines={1}>
            {name}
          </Text>
          <ThemedIcon Icon={X} uniProps={mutedColor} size={10} />
        </PressHighlight>
      </TooltipTrigger>
      <TooltipContent side="right" align="center" offset={6}>
        <Text style={styles.tooltip}>{clearLabel}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function RailHelp({ section }: { section: BuiltinSection }) {
  const label = useSectionLabel(section);
  const trigger = useMemo(
    () => ({
      style: styles.item,
      side: "right" as const,
      align: "end" as const,
      render: (state: MenuTriggerState) => (
        <RailContent
          Icon={CircleHelp}
          label={label}
          active={state.open}
          hovered={state.hovered || state.pressed}
        />
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
        style={styles.item}
        accessibilityRole="button"
        accessibilityLabel={section.group.title}
        testID={`navigation-rail-${section.key}`}
      >
        {(state: MenuTriggerState) => (
          <RailContent
            Icon={Icon as LucideIcon}
            label={section.group.title}
            active={state.open}
            hovered={state.hovered || state.pressed}
          />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" width={SECTION_MENU_WIDTH}>
        <View ref={anchor} collapsable={false} style={styles.pluginMenu}>
          <RailPluginMenuItem section={section} anchor={anchor} />
        </View>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RailButton({
  Icon,
  label,
  tooltip,
  active = false,
  onPress,
  badge,
  dot,
  caption,
  testID,
}: {
  Icon: LucideIcon;
  label: string;
  /** Quieter lines under the label: Hosts' online / total, a session's quota. */
  caption?: ReactNode;
  tooltip?: string;
  active?: boolean;
  onPress: () => void;
  badge?: ReactNode;
  dot?: ReactNode;
  testID: string;
}) {
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
          style={styles.item}
          testID={testID}
        >
          {({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => (
            <RailContent
              Icon={Icon}
              label={label}
              active={active}
              hovered={Boolean(hovered) || pressed}
              badge={badge}
              dot={dot}
              caption={caption}
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
  caption,
}: {
  Icon: LucideIcon;
  label: string;
  active: boolean;
  hovered: boolean;
  badge?: ReactNode;
  dot?: ReactNode;
  caption?: ReactNode;
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
      {typeof caption === "string" ? (
        <Text style={styles.caption} numberOfLines={1}>
          {caption}
        </Text>
      ) : (
        caption
      )}
    </>
  );
}

function Glyph({
  Icon,
  color,
  size = ICON_SIZE.lg,
}: {
  Icon: ComponentType<{ size: number; color?: string; strokeWidth?: number }>;
  color?: string;
  size?: number;
}) {
  return <Icon size={size} color={color} strokeWidth={ICON_STROKE_WIDTH} />;
}
const ThemedIcon = withUnistyles(Glyph);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const strongColor = (theme: Theme) => ({ color: theme.colors.foreground });

/** The plugin's item inside its rail menu; the menu closes when the item opens a screen. */
function RailPluginMenuItem({
  section,
  anchor,
}: {
  section: PluginSection;
  anchor: RefObject<View | null>;
}) {
  const close = useDropdownMenuClose();
  return (
    <PluginSidebarItem
      group={section.group}
      section={section.rail === "primary" ? "header" : "footer"}
      fallbackAnchorRef={anchor}
      onBeforeNavigate={close}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  rail: {
    width: RAIL_WIDTH,
    flex: 1,
    backgroundColor: theme.colors.surfaceSidebar,
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
    paddingBottom: theme.spacing[3],
  },
  dragArea: { height: theme.spacing[3] },
  chromeSpacer: { height: theme.spacing[0] },
  group: { gap: theme.spacing[1], alignItems: "stretch", flexShrink: 1 },
  spacer: { flex: 1 },
  item: {
    alignItems: "center",
    gap: theme.spacing[0.5],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    minHeight: MIN_TOUCH_TARGET_SIZE,
  },
  glyph: {
    height: CONTROL_HEIGHTS.compact,
    paddingHorizontal: theme.spacing[3],
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
  caption: {
    maxWidth: RAIL_WIDTH - theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 14,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  // A plain text tag under Hosts: no pill, small, so it costs one short line of the rail.
  hostTag: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 1,
    maxWidth: RAIL_WIDTH - theme.spacing[2],
    paddingHorizontal: theme.spacing[0.5],
    marginTop: -theme.spacing[1.5],
    borderRadius: theme.borderRadius.sm,
  },
  hostTagLabel: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    ...RAIL_MICRO_TEXT,
  },
  badge: { position: "absolute", top: -theme.spacing[1.5], right: -theme.spacing[2] },
  dot: { position: "absolute", top: theme.spacing[1], right: theme.spacing[1.5] },
  tooltip: { color: theme.colors.popoverForeground, fontSize: theme.fontSize.sm },
  pluginMenu: { padding: theme.spacing[1] },
}));
