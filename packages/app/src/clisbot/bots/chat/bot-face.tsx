import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { projectIconRadius } from "@/components/project-icon-view";
import { deriveIdentityColorName, identityColor, identityTint } from "@/styles/identity-colors";

const DEFAULT_SIZE = 20;

/**
 * A bot's face: its avatar text when the record has one, else two initials of its name on the
 * identity colour derived from its id — stable per bot across the sidebar and the chat. Same
 * rounded square as a project icon, so a Bot and a Project read as one kind of mark.
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
        borderRadius: projectIconRadius(size),
        backgroundColor: identityTint(colorName),
      },
    ],
    [colorName, size],
  );
  const glyphStyle = useMemo(
    () => [styles.glyph, { color: identityColor(colorName), fontSize: Math.round(size * 0.48) }],
    [colorName, size],
  );
  const glyph = avatar?.trim() || botInitials(name);
  return (
    <View style={frameStyle} testID={`bot-face-${botId}`} accessibilityLabel={name}>
      <Text style={glyphStyle} numberOfLines={1}>
        {glyph}
      </Text>
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

const styles = StyleSheet.create((theme) => ({
  frame: { alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 },
  glyph: { fontWeight: theme.fontWeight.semibold, lineHeight: undefined },
}));
