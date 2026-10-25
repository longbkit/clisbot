import { useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Search, type LucideIcon } from "lucide-react-native";
import { ScreenHeader } from "@/components/headers/screen-header";
import { ScreenTitle } from "@/components/headers/screen-title";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { ICON_SIZE, ICON_STROKE_WIDTH, type Theme } from "@/styles/theme";
import { DISPLAY_MENU_WIDTH } from "@/components/sidebar/display-preferences/menu";

/**
 * A section's header (brief C5): its title, then its own actions as icons. Search and New belong
 * to the section; there is no global search bar or New row.
 */
export function SectionHeader({
  title,
  center,
  centerInline = false,
  actions,
  testID,
}: {
  title: ReactNode;
  /** Home's mode switch sits between the title and the actions. */
  center?: ReactNode;
  /** Keep `center` in the title row on a phone too, instead of a row of its own. */
  centerInline?: boolean;
  actions?: ReactNode;
  testID?: string;
}) {
  const compact = useIsCompactFormFactor();
  const left = useMemo(
    () => (
      <View style={styles.left}>
        {typeof title === "string" ? <ScreenTitle>{title}</ScreenTitle> : title}
        {center && (!compact || centerInline) ? <View style={styles.center}>{center}</View> : null}
      </View>
    ),
    [center, centerInline, compact, title],
  );
  const right = useMemo(() => <View style={styles.actions}>{actions}</View>, [actions]);
  return (
    <View testID={testID}>
      <ScreenHeader borderless left={left} right={right} />
      {center && compact && !centerInline ? (
        <View style={styles.centerCompact}>{center}</View>
      ) : null}
    </View>
  );
}

const ThemedIcon = withUnistyles(
  ({ Icon, color }: { Icon: LucideIcon; color?: string }) => (
    <Icon size={ICON_SIZE.md} color={color} strokeWidth={ICON_STROKE_WIDTH} />
  ),
  (theme: Theme) => ({ color: theme.colors.foregroundMuted }),
);

export function HeaderIconButton({
  Icon,
  label,
  onPress,
  testID,
  shortcutAction,
}: {
  Icon: LucideIcon;
  label: string;
  onPress: () => void;
  testID: string;
  shortcutAction?: string;
}) {
  const shortcut = useShortcutKeys(shortcutAction ?? null);
  return (
    <ToolbarButton label={label} onPress={onPress} testID={testID} shortcut={shortcut ?? undefined}>
      <ThemedIcon Icon={Icon} />
    </ToolbarButton>
  );
}

/** Search in a section header; ⌘K is its shortcut everywhere (brief 3.1a). */
export function HeaderSearchButton({ onPress, testID }: { onPress: () => void; testID: string }) {
  const { t } = useTranslation();
  return (
    <HeaderIconButton
      Icon={Search}
      label={t("navigation.actions.search")}
      onPress={onPress}
      testID={testID}
      shortcutAction="toggle-command-center"
    />
  );
}

/** Every Navigation V2 menu (New, row actions, Display) opens at one width. */
export const SECTION_MENU_WIDTH = DISPLAY_MENU_WIDTH;

export function HeaderMenuIcon({ Icon }: { Icon: LucideIcon }) {
  return <ThemedIcon Icon={Icon} />;
}

const styles = StyleSheet.create((theme) => ({
  left: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  center: { flexShrink: 1, minWidth: 0 },
  centerCompact: { paddingHorizontal: theme.spacing[3], paddingBottom: theme.spacing[2] },
  actions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
}));
