// Rows of the Connections list (docs/design.md, rows): a Route row opens its
// editor, so the whole row presses and a chevron ends it; adding a Route is the
// card's last row, kept apart from the Connection's switch in the header.

import { ChevronRight, Plus } from "lucide-react-native";
import { useCallback, useState, type ReactNode } from "react";
import {
  type GestureResponderEvent,
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";

const ThemedChevronRight = withUnistyles(ChevronRight);
const chevronProps = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});

type RowState = PressableStateCallbackType & { hovered?: boolean };

/** A row that opens its detail. Controls inside it keep their own presses. */
export function DrillRow({
  label,
  style,
  disabled,
  onPress,
  children,
}: {
  label: string;
  style: StyleProp<ViewStyle>;
  disabled: boolean;
  onPress(): void;
  children: ReactNode;
}) {
  const rowStyle = useCallback(
    ({ hovered, pressed }: RowState) => [
      style,
      hovered && styles.hovered,
      pressed && styles.pressed,
    ],
    [style],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={rowStyle}
    >
      {children}
    </Pressable>
  );
}

/** For a control inside a `DrillRow`: its press stays its own. */
export function keepPressInControl(event: GestureResponderEvent) {
  event.stopPropagation();
}

/** Ends a `DrillRow`: chevron means navigation. */
export function DrillChevron() {
  return <ThemedChevronRight uniProps={chevronProps} />;
}

/** Past this, a runtime error folds to its first lines until asked for. */
const LONG_DETAIL_CHARACTERS = 240;

/**
 * Why a Connection is not running, as the Hub reports it. A runtime error can
 * run to hundreds of lines (a load-trace miss lists every module): it shows two
 * lines and opens on request, and stays selectable for a bug report.
 */
export function RuntimeDetailRow({ detail }: { detail: string }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const long = detail.length > LONG_DETAIL_CHARACTERS || detail.includes("\n");
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder, styles.detailRow]}>
      <Text style={styles.detail} selectable numberOfLines={long && !open ? 2 : undefined}>
        {detail}
      </Text>
      {long ? (
        <Button size="xs" variant="ghost" onPress={toggle}>
          {open ? "Hide details" : "Show details"}
        </Button>
      ) : null}
    </View>
  );
}

export function AddRouteRow({ disabled, onPress }: { disabled: boolean; onPress(): void }) {
  return (
    <View style={[settingsStyles.rowBorder, styles.addRow]}>
      <View style={styles.addButton}>
        <Button size="sm" variant="ghost" leftIcon={Plus} disabled={disabled} onPress={onPress}>
          Add Route
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  hovered: { backgroundColor: theme.colors.surface2 },
  detailRow: { flexDirection: "column", alignItems: "flex-start", gap: theme.spacing[1] },
  detail: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  pressed: { backgroundColor: theme.colors.surface3 },
  addRow: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  // The ghost button's own padding moves out, so its "+" sits on the rows' text rail.
  addButton: {
    alignItems: "flex-start",
    marginLeft: -(theme.spacing[3] + 1),
  },
}));
