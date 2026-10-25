import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { PressHighlight } from "@/components/ui/press-highlight";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronRight, Puzzle, type LucideIcon } from "lucide-react-native";
import { ConnectionStatusDot } from "@/components/host-status-dot";
import {
  SidebarHostPicker,
  type SidebarHostPickerTrigger,
} from "@/components/sidebar/sidebar-footer-controls";
import { SidebarHelpMenu } from "@/components/sidebar/sidebar-help-menu";
import type { MenuTriggerState } from "@/components/ui/menu/menu-root";
import { StatusBadge } from "@/components/ui/status-badge";
import { openHostOverview } from "@/navigation/settings-navigation";
import { pluginIconComponent } from "@/plugins/icons";
import { PluginSidebarItem } from "@/plugins/sidebar-items";
import { UsageSidebarRoot, useOpenSidebarUsage } from "@/usage";
import { buildSettingsAddHostRoute, buildSettingsRoute } from "@/utils/host-routes";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { useHostsStatus } from "./hosts-status";
import { SECTION_ICONS } from "./rail";
import type { BuiltinSection, NavigationSection, PluginSection } from "./sections";
import { SectionHeader } from "./section-header";
import { useNavigationSections } from "./use-navigation-sections";

/** The phone's More (brief C10): every section that is not a tab, Settings last. */
export function MoreScreen() {
  const { t } = useTranslation();
  const { more } = useNavigationSections();
  const settings = more.filter((section) => section.key === "settings");
  const rest = more.filter((section) => section.key !== "settings");
  return (
    <UsageSidebarRoot>
      <View style={styles.page} testID="more-screen">
        <SectionHeader title={t("navigation.sections.more")} />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={settingsStyles.card}>
            {rest.map((section, index) => (
              <MoreEntry key={section.key} section={section} last={index === rest.length - 1} />
            ))}
          </View>
          <View style={settingsStyles.card}>
            {settings.map((section) => (
              <MoreEntry key={section.key} section={section} last />
            ))}
          </View>
        </ScrollView>
      </View>
    </UsageSidebarRoot>
  );
}

function MoreEntry({ section, last }: { section: NavigationSection; last: boolean }) {
  if (section.kind === "plugin") return <MorePlugin section={section} last={last} />;
  if (section.id === "hosts") return <MoreHosts section={section} last={last} />;
  if (section.id === "help") return <MoreHelp section={section} last={last} />;
  if (section.id === "usage") return <MoreUsage section={section} last={last} />;
  return <MoreRoute section={section} last={last} />;
}

function MoreRoute({ section, last }: { section: BuiltinSection; last: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const open = useCallback(() => {
    router.push((section.id === "settings" ? buildSettingsRoute() : section.href) as Href);
  }, [router, section]);
  const previewLabel = t("navigation.preview");
  const badge = useMemo(
    () => (section.status === "preview" ? <StatusBadge label={previewLabel} size="xs" /> : null),
    [previewLabel, section.status],
  );
  return (
    <MoreRow
      Icon={SECTION_ICONS[section.id]}
      label={t(section.labelKey)}
      onPress={open}
      trailing={badge}
      last={last}
      testID={`more-${section.id}`}
    />
  );
}

function MoreUsage({ section, last }: { section: BuiltinSection; last: boolean }) {
  const { t } = useTranslation();
  const openUsage = useOpenSidebarUsage();
  return (
    <MoreRow
      Icon={SECTION_ICONS.usage}
      label={t(section.labelKey)}
      onPress={openUsage}
      last={last}
      testID="more-usage"
    />
  );
}

function MoreHosts({ section, last }: { section: BuiltinSection; last: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const status = useHostsStatus();
  const addHost = useCallback(() => router.push(buildSettingsAddHostRoute(Date.now())), [router]);
  const label = t(section.labelKey);
  const dot = useMemo(() => <ConnectionStatusDot status={status} />, [status]);
  const renderTrigger = useCallback(
    (trigger: SidebarHostPickerTrigger) => (
      <View ref={trigger.ref} collapsable={false}>
        <MoreRow
          Icon={SECTION_ICONS.hosts}
          label={label}
          onPress={trigger.onPress}
          trailing={dot}
          last={last}
          testID="more-hosts"
        />
      </View>
    ),
    [dot, label, last],
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

function MoreHelp({ section, last }: { section: BuiltinSection; last: boolean }) {
  const { t } = useTranslation();
  const label = t(section.labelKey);
  const trigger = useMemo(
    () => ({
      style: (state: MenuTriggerState) => rowStyle(last, state),
      render: () => <RowBody Icon={SECTION_ICONS.help} label={label} />,
    }),
    [label, last],
  );
  return <SidebarHelpMenu trigger={trigger} />;
}

function MorePlugin({ section, last }: { section: PluginSection; last: boolean }) {
  const anchor = useRef<View | null>(null);
  return (
    <View
      ref={anchor}
      collapsable={false}
      style={[styles.plugin, !last && styles.divider]}
      testID={`more-${section.key}`}
    >
      <PluginSidebarItem
        group={section.group}
        section={section.rail === "primary" ? "header" : "footer"}
        fallbackAnchorRef={anchor}
      />
    </View>
  );
}

export function pluginSectionIcon(section: PluginSection): LucideIcon {
  return (
    section.group.kind === "legacy" ? pluginIconComponent(section.group.icon) : Puzzle
  ) as LucideIcon;
}

function rowStyle(last: boolean, { hovered, pressed }: { hovered?: boolean; pressed: boolean }) {
  return [styles.row, !last && styles.divider, (hovered || pressed) && styles.rowHovered];
}

function MoreRow({
  Icon,
  label,
  onPress,
  trailing,
  last,
  testID,
}: {
  Icon: LucideIcon;
  label: string;
  onPress: () => void;
  trailing?: ReactNode;
  last: boolean;
  testID: string;
}) {
  const style = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) => rowStyle(last, state),
    [last],
  );
  return (
    <PressHighlight accessibilityRole="button" onPress={onPress} style={style} testID={testID}>
      <RowBody Icon={Icon} label={label} trailing={trailing} />
    </PressHighlight>
  );
}

function RowBody({
  Icon,
  label,
  trailing,
}: {
  Icon: LucideIcon;
  label: string;
  trailing?: ReactNode;
}) {
  return (
    <>
      <ThemedIcon Icon={Icon} uniProps={muted} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {trailing}
      <ThemedIcon Icon={ChevronRight} uniProps={muted} />
    </>
  );
}

const ThemedIcon = withUnistyles(({ Icon, color }: { Icon: LucideIcon; color?: string }) => (
  <Icon size={18} color={color} />
));
const muted = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const styles = StyleSheet.create((theme) => ({
  page: { flex: 1, backgroundColor: theme.colors.surfaceSettings },
  content: { padding: theme.spacing[4], gap: theme.spacing[4] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    minHeight: 48,
    paddingHorizontal: theme.spacing[4],
  },
  rowHovered: { backgroundColor: theme.colors.surface2 },
  divider: { borderBottomWidth: 1, borderBottomColor: theme.colors.borderSubtle },
  label: { flex: 1, minWidth: 0, color: theme.colors.foreground, fontSize: theme.fontSize.base },
  plugin: { paddingHorizontal: theme.spacing[2], paddingVertical: theme.spacing[1] },
}));
