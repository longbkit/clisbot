import { Check } from "lucide-react-native";
import { type ReactNode, useCallback, useMemo } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { settingsStyles } from "@/styles/settings";

const ThemedCheck = withUnistyles(Check);
const foreground = (theme: Theme) => ({ color: theme.colors.foreground });

/** One checkbox row of a Connectors picker sheet: the box, then whatever the row shows. */
export function CheckOption({
  id,
  bordered,
  checked,
  onToggle,
  testID,
  children,
}: {
  id: string;
  bordered: boolean;
  checked: boolean;
  onToggle(id: string): void;
  testID?: string;
  children: ReactNode;
}) {
  const press = useCallback(() => onToggle(id), [id, onToggle]);
  const state = useMemo(() => ({ checked }), [checked]);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={state}
      onPress={press}
      style={bordered ? [styles.row, settingsStyles.rowBorder] : styles.row}
      testID={testID}
    >
      <View style={styles.box}>
        {checked ? <ThemedCheck size={ICON_SIZE.sm} uniProps={foreground} /> : null}
      </View>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
  },
  box: {
    width: 18,
    height: 18,
    borderRadius: theme.borderRadius.base,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    alignItems: "center",
    justifyContent: "center",
  },
}));
