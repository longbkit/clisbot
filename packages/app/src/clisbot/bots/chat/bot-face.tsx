import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { deriveIdentityColorName, identityColor, identityTint } from "@/styles/identity-colors";

const DEFAULT_SIZE = 20;

/**
 * A bot's face: its avatar text when the record has one, else the first letter of its name on
 * the identity colour derived from its id — stable per bot across the sidebar and the chat.
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
  const frameStyle = useMemo(
    () => [
      styles.frame,
      {
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: identityTint(colorName),
      },
    ],
    [colorName, size],
  );
  const glyphStyle = useMemo(
    () => [styles.glyph, { color: identityColor(colorName), fontSize: Math.round(size * 0.55) }],
    [colorName, size],
  );
  const glyph = avatar?.trim() || name.trim().charAt(0).toUpperCase() || "?";
  return (
    <View style={frameStyle} testID={`bot-face-${botId}`} accessibilityLabel={name}>
      <Text style={glyphStyle} numberOfLines={1}>
        {glyph}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: { alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 },
  glyph: { fontWeight: theme.fontWeight.medium, lineHeight: undefined },
}));
