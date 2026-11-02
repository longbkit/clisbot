import { useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
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
  centerMiddle = false,
  actions,
  testID,
}: {
  title: ReactNode;
  /** Home's mode switch sits between the title and the actions. */
  center?: ReactNode;
  /** Keep `center` in the title row on a phone too, instead of a row of its own. */
  centerInline?: boolean;
  /**
   * On desktop, put `center` in the middle of the header rather than after the title. The header
   * spans the same pane as the page under it, so this is the centre line of a centred column.
   */
  centerMiddle?: boolean;
  actions?: ReactNode;
  testID?: string;
}) {
  const compact = useIsCompactFormFactor();
  const middle = !!center && centerMiddle && !compact;
  const left = useMemo(
    () => (
      <View style={styles.left}>
        <SectionTitle title={title} compact={compact} />
        {center && !middle && (!compact || centerInline) ? (
          <View style={styles.center}>{center}</View>
        ) : null}
      </View>
    ),
    [center, centerInline, compact, middle, title],
  );
  const right = useMemo(() => <View style={styles.actions}>{actions}</View>, [actions]);
  return (
    <View testID={testID} style={styles.frame}>
      {/* A section header sits on its pane's surface (the sidebar's gray on desktop, the page's
          white on a phone); ScreenHeader's own white drew a strip across the gray column. Its
          bottom line is always on: it separates the title from the controls under it. */}
      <ScreenHeader transparent left={left} right={right} />
      {middle ? (
        <View style={styles.middle} pointerEvents="box-none">
          {center}
        </View>
      ) : null}
      {center && compact && !centerInline ? (
        <View style={styles.centerCompact}>{center}</View>
      ) : null}
    </View>
  );
}

function SectionTitle({ title, compact }: { title: ReactNode; compact: boolean }) {
  if (typeof title !== "string") return title;
  if (!compact) return <ScreenTitle>{title}</ScreenTitle>;
  return (
    <Text style={styles.phoneTitle} numberOfLines={1}>
      {title}
    </Text>
  );
}

const ThemedIcon = withUnistyles(
  ({ Icon, color, size }: { Icon: LucideIcon; color?: string; size?: number }) => (
    <Icon size={size ?? ICON_SIZE.md} color={color} strokeWidth={ICON_STROKE_WIDTH} />
  ),
  (theme: Theme) => ({ color: theme.colors.foregroundMuted }),
);

const PhoneIcon = withUnistyles(
  ({ Icon, color }: { Icon: LucideIcon; color?: string }) => (
    <Icon size={PHONE_HEADER_ICON_SIZE} color={color} strokeWidth={ICON_STROKE_WIDTH} />
  ),
  (theme: Theme) => ({ color: theme.colors.foreground }),
);

/** A phone's title row is the thumb's: Telegram-sized icons in 44px targets. */
const PHONE_HEADER_ICON_SIZE = 24;

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
  const compact = useIsCompactFormFactor();
  return (
    <ToolbarButton
      label={label}
      onPress={onPress}
      testID={testID}
      shortcut={shortcut ?? undefined}
      style={compact ? styles.phoneTarget : undefined}
    >
      {compact ? <PhoneIcon Icon={Icon} /> : <ThemedIcon Icon={Icon} />}
    </ToolbarButton>
  );
}

/** A section header's menu trigger (New), the same size as its other buttons. */
export function HeaderMenuButton({
  Icon,
  label,
  testID,
}: {
  Icon: LucideIcon;
  label: string;
  testID: string;
}) {
  const compact = useIsCompactFormFactor();
  return (
    <ToolbarButton
      kind="menu"
      label={label}
      testID={testID}
      style={compact ? styles.phoneTarget : undefined}
    >
      {compact ? <PhoneIcon Icon={Icon} /> : <ThemedIcon Icon={Icon} />}
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
  phoneTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  phoneTarget: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  left: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  center: { flexShrink: 1, minWidth: 0 },
  frame: { position: "relative" },
  // Over the header row, in its middle; taps outside the control reach the row (and its drag area).
  middle: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  centerCompact: { paddingHorizontal: theme.spacing[3], paddingBottom: theme.spacing[2] },
  actions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
}));
