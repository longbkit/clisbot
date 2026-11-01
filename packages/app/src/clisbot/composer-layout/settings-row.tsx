import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent, type ViewProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { readMeasuredWidth } from "@/hooks/use-container-width";

/**
 * Below this width the settings row is short of room for every label: after the Model chip's
 * effort and the Mode label (the picker's own density, `composer-picker/picker-agent-controls`)
 * the Tools chip keeps its icon and count.
 */
export const NARROW_SETTINGS_ROW_WIDTH = 400;
const HYSTERESIS = 12;

export function resolveSettingsRowNarrow(width: number, wasNarrow: boolean): boolean {
  return wasNarrow
    ? width < NARROW_SETTINGS_ROW_WIDTH + HYSTERESIS
    : width < NARROW_SETTINGS_ROW_WIDTH;
}

interface SettingsRowValue {
  /** Inside the chat composer's settings row, and whether it is short of room. */
  inRow: boolean;
  narrow: boolean;
}

const SettingsRowContext = createContext<SettingsRowValue>({ inRow: false, narrow: false });

/** Whether a control in the composer's settings row should drop its label. */
export function useComposerSettingsRow(): SettingsRowValue {
  return useContext(SettingsRowContext);
}

/**
 * A counting chip in a narrow settings row (the Tools chip): its icon and the count, or the icon
 * alone when nothing is on. The accessible name keeps the full label.
 */
export function useSettingsRowCountLabel(
  label: string,
  count: number,
): { value: string; showLabel: boolean } {
  const { narrow } = useComposerSettingsRow();
  if (!narrow) return { value: label, showLabel: true };
  return count > 0 ? { value: String(count), showLabel: true } : { value: label, showLabel: false };
}

/**
 * The quiet row under the pill: Model chip, Mode and Tools at the start, the context ring at the
 * end. A phone starts narrow so its first paint already shows the collapsed row.
 */
export function ComposerSettingsRow({
  start,
  end,
  initialNarrow,
  style,
}: {
  start: ReactNode;
  end: ReactNode;
  initialNarrow: boolean;
  /** Where the row starts: the pill's left edge (`layout-styles.ts`). */
  style?: ViewProps["style"];
}) {
  const [narrow, setNarrow] = useState(initialNarrow);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const width = readMeasuredWidth(event);
    if (width === null) return;
    setNarrow((was) => resolveSettingsRowNarrow(width, was));
  }, []);
  const value = useMemo(() => ({ inRow: true, narrow }), [narrow]);
  const rowStyle = useMemo(() => [styles.row, style], [style]);
  return (
    <SettingsRowContext.Provider value={value}>
      <View style={rowStyle} onLayout={handleLayout} testID="composer-settings-row">
        <View style={styles.start}>{start}</View>
        {end ? <View style={styles.end}>{end}</View> : null}
      </View>
    </SettingsRowContext.Provider>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  start: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  end: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
  },
}));
