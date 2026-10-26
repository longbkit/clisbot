import { createContext, useContext } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Pin } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

const ThemedPin = withUnistyles(Pin, (theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.xs,
}));

/** The one "pinned" mark: list rows, floated pins and pin tags all draw this glyph. */
export function PinMark({ testID = "pin-mark" }: { testID?: string }) {
  const { t } = useTranslation();
  return (
    <View
      accessible
      accessibilityLabel={t("bots.workspace.sidebar.pinned")}
      style={styles.mark}
      testID={testID}
    >
      <ThemedPin />
    </View>
  );
}

const PinnedRowContext = createContext(false);

/**
 * Marks the row inside as pinned. The row draws `PinMark` at the end of its title line, in the
 * same place on every list, instead of the list drawing a mark in the gutter.
 */
export const PinnedRowProvider = PinnedRowContext.Provider;

export function usePinnedRow(): boolean {
  return useContext(PinnedRowContext);
}

const styles = StyleSheet.create((theme) => ({
  mark: { justifyContent: "center", paddingHorizontal: theme.spacing[0.5] },
}));
