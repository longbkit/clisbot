import { useCallback, useMemo, useState } from "react";
import { Image } from "expo-image";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { deriveIdentityColorName, identityColor } from "@/styles/identity-colors";

/** The identity an MCP server's letter badge is colored by, the same on every surface. */
export function serverLogoKey(name: string): string {
  return `mcp:${name}`;
}

/**
 * An app's logo from Composio, or its first letter on the identity color its slug picks
 * (design.md §13, identity badges). An MCP server always uses the letter: it has no logo.
 * The box is the same size either way, so a logo arriving late never moves the row.
 * Composio serves SVG logos, which React Native's Image cannot draw on iOS or Android;
 * expo-image can.
 */
export function ConnectorLogo({
  slug,
  name,
  logo,
  size = "sm",
}: {
  slug: string;
  name: string;
  logo?: string;
  size?: "sm" | "lg";
}) {
  // Remember which URL failed, so a new or retried logo is tried again.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const onError = useCallback(() => setFailedUri(logo ?? null), [logo]);
  const failed = logo !== undefined && failedUri === logo;
  const box = size === "lg" ? styles.boxLarge : styles.boxSmall;
  const fill = useMemo(
    () => ({ backgroundColor: identityColor(deriveIdentityColorName(slug)) }),
    [slug],
  );
  const source = useMemo(() => (logo ? { uri: logo } : null), [logo]);
  if (source && !failed) {
    return (
      <View style={[box, styles.logoFrame]}>
        <Image source={source} onError={onError} style={IMAGE_SIZE[size]} contentFit="contain" />
      </View>
    );
  }
  return (
    <View style={[box, styles.letterFrame, fill]} accessibilityElementsHidden>
      <Text style={size === "lg" ? styles.letterLarge : styles.letter}>
        {(name.trim()[0] ?? "?").toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * Plain objects, not Unistyles: on web Unistyles turns a style into a class that expo-image
 * never applies, and the logo drew at 0 px (docs/unistyles.md, third-party views).
 */
const IMAGE_SIZE = {
  sm: { width: 20, height: 20 },
  lg: { width: 34, height: 34 },
} as const;

const styles = StyleSheet.create((theme) => ({
  boxSmall: { width: 24, height: 24, borderRadius: theme.borderRadius.md },
  boxLarge: { width: 40, height: 40, borderRadius: theme.borderRadius.lg },
  logoFrame: {
    overflow: "hidden",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  letterFrame: { alignItems: "center", justifyContent: "center" },
  letter: { color: "#ffffff", fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium },
  letterLarge: {
    color: "#ffffff",
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
  },
}));
