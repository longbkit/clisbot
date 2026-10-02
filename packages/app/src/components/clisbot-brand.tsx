import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ClisbotLogo } from "@/components/icons/clisbot-logo";
import { baseColors, SPACING } from "@/styles/theme";

/** The same Ocean mark on settings pages and beside the sidebar account control. */
export function ClisbotBrand({ iconOnly = false }: { iconOnly?: boolean }) {
  const size = iconOnly ? SPACING[8] : SPACING[12];

  return (
    <View style={styles.lockup}>
      <View style={[styles.mark, iconOnly && styles.compactMark]}>
        {/* The SVG has its own inset; the artwork fills 62% of the brand tile. */}
        <ClisbotLogo size={(size * 62) / 72} color={baseColors.brand.seafoam} />
      </View>
      {!iconOnly ? <Text style={styles.name}>Clisbot</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  lockup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  mark: {
    width: theme.spacing[12],
    height: theme.spacing[12],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.palette.brand.ocean,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  compactMark: {
    width: theme.spacing[8],
    height: theme.spacing[8],
    borderRadius: theme.borderRadius.lg,
  },
  name: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["4xl"],
    fontWeight: theme.fontWeight.bold,
  },
}));
