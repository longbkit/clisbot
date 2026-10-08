import { type ReactNode, useId, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { projectIconRadius } from "@/components/project-icon-view";
import {
  deriveIdentityColorName,
  identityGradient,
  type IdentityColorName,
} from "@/styles/identity-colors";

const DEFAULT_SIZE = 20;

/**
 * A bot's face: its avatar text when the record has one, else two initials of its name, in white
 * on the glossy identity fill derived from its id — stable per bot across the sidebar and the chat.
 */
export function BotFace({
  botId,
  name,
  avatar,
  size = DEFAULT_SIZE,
}: {
  botId: string;
  name: string;
  avatar?: string | null;
  size?: number;
}) {
  const colorName = useMemo(() => deriveIdentityColorName(botId), [botId]);
  const glyphStyle = useMemo(() => [styles.glyph, { fontSize: Math.round(size * 0.42) }], [size]);
  const glyph = avatar?.trim() || botInitials(name);
  return (
    <GlossyMark
      colorName={colorName}
      size={size}
      testID={`bot-face-${botId}`}
      accessibilityLabel={name}
    >
      <Text style={glyphStyle} numberOfLines={1}>
        {glyph}
      </Text>
    </GlossyMark>
  );
}

/**
 * The rounded square behind a Bot face and a Group chat mark: the identity hue as a diagonal
 * gradient with a faint light rim, so the mark reads as a lit tile rather than a flat swatch.
 */
export function GlossyMark({
  colorName,
  size,
  testID,
  accessibilityLabel,
  children,
}: {
  colorName: IdentityColorName;
  size: number;
  testID?: string;
  accessibilityLabel?: string;
  children: ReactNode;
}) {
  const radius = projectIconRadius(size);
  const frameStyle = useMemo(
    () => [styles.frame, { width: size, height: size, borderRadius: radius }],
    [size, radius],
  );
  return (
    <View style={frameStyle} testID={testID} accessibilityLabel={accessibilityLabel}>
      <GlossyFill colorName={colorName} width={size} height={size} />
      <View style={[styles.rim, { borderRadius: radius }]} pointerEvents="none" />
      {children}
    </View>
  );
}

/**
 * The identity hue as a diagonal gradient filling its parent, which owns the shape and the clip.
 * Shared by `GlossyMark` and each cell of a Group chat's member mosaic.
 */
export function GlossyFill({
  colorName,
  width,
  height,
}: {
  colorName: IdentityColorName;
  width: number;
  height: number;
}) {
  const gradientId = `glossy-fill-${useId().replace(/:/g, "")}`;
  const [lit, shaded] = identityGradient(colorName);
  // The wrapper is what takes the absolute position: react-native-svg on web ignores it on the
  // Svg itself and lays the gradient out in flow, pushing the glyph below the clip.
  return (
    <View style={styles.fill} pointerEvents="none">
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={lit} />
            <Stop offset="1" stopColor={shaded} />
          </LinearGradient>
        </Defs>
        <Rect width={width} height={height} fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  );
}

/** "cfo" → "CF", "Room tools check" → "RT": two letters tell `cfo` from `cto`. */
export function botInitials(name: string): string {
  const words = name
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length > 1 ? words[0].charAt(0) + words[1].charAt(0) : words[0].slice(0, 2);
  return letters.toUpperCase();
}

// The rim and the glyph are white on every theme: the identity fills are held to one contrast
// band against a white letter (`identity-colors.ts`), not against the surface.
const styles = StyleSheet.create((theme) => ({
  frame: { alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 },
  fill: StyleSheet.absoluteFillObject,
  rim: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.18)",
  },
  glyph: {
    color: "#ffffff",
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: 0.3,
    lineHeight: undefined,
  },
}));
