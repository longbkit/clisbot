import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ClisbotLogo } from "@/components/icons/clisbot-logo";
import { SPACING, type Theme } from "@/styles/theme";

const BrandLogo = withUnistyles(ClisbotLogo);
const brandLogoColor = (theme: Theme) => ({
  color:
    theme.colorScheme === "dark"
      ? theme.colors.palette.brand.seafoam
      : theme.colors.palette.brand.ocean,
});

/** A transparent Flow mark shared by settings and the sidebar account row. */
export function ClisbotBrand({ iconOnly = false }: { iconOnly?: boolean }) {
  const size = iconOnly ? SPACING[8] : SPACING[12];

  return (
    <View style={styles.lockup}>
      <View style={[styles.mark, iconOnly && styles.compactMark]}>
        <BrandLogo size={size} uniProps={brandLogoColor} />
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
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  compactMark: {
    width: theme.spacing[8],
    height: theme.spacing[8],
  },
  name: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["4xl"],
    fontWeight: theme.fontWeight.bold,
  },
}));
