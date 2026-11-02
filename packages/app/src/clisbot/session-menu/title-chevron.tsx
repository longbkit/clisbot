import { View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { ICON_SIZE } from "@/styles/theme";

const ThemedChevron = withUnistyles(ChevronDown);

/**
 * Says a phone session's title opens a sheet. `attention` carries the dot ⋯ used to wear while a
 * workspace service is unhealthy.
 */
export function SessionTitleChevron({ attention = false }: { attention?: boolean }) {
  return (
    <View style={styles.slot} testID="session-title-chevron">
      <ThemedChevron size={ICON_SIZE.sm} uniProps={mutedIconColorMapping} />
      {attention ? <View style={styles.dot} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  slot: { flexShrink: 0, position: "relative" },
  // The Scripts row's red, as on ⋯.
  dot: {
    position: "absolute",
    top: -1,
    right: -2,
    width: theme.spacing[1.5],
    height: theme.spacing[1.5],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.red[500],
  },
}));
