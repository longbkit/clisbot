import { useCallback, type ComponentType } from "react";
import { Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { X } from "lucide-react-native";
import { PressHighlight } from "@/components/ui/press-highlight";

const ThemedX = withUnistyles(X, (theme) => ({ color: theme.colors.foregroundMuted }));

export type ScopeChipIcon = ComponentType<{ size: number; strokeWidth: number }>;

/**
 * A scope in the search field: the file scope, or a Host / Hub / Project filter. Pressing it
 * removes it. A suggestion is a dashed chip that applies a scope instead of removing one.
 *
 * The chip sits at the input's own height and type size so it reads as the scope of the field
 * rather than a badge dropped into the query. Its 28px matches the input's line box, so showing or
 * dropping the scope cannot resize the header.
 */
export function ScopeChip({
  label,
  icon: Icon,
  onPress,
  accessibilityLabel,
  testID,
  suggestion = false,
}: {
  label: string;
  icon: ScopeChipIcon;
  onPress(): void;
  accessibilityLabel?: string;
  testID: string;
  suggestion?: boolean;
}) {
  const style = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.scopeChip,
      suggestion && styles.suggestion,
      (Boolean(hovered) || pressed) && styles.hovered,
    ],
    [suggestion],
  );
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={style}
      testID={testID}
    >
      <Icon size={14} strokeWidth={2.2} />
      <Text style={styles.scopeChipLabel} numberOfLines={1}>
        {label}
      </Text>
      {suggestion ? null : <ThemedX size={12} strokeWidth={2.2} />}
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  scopeChip: {
    // Stretching to the row rather than setting a height keeps the chip exactly as tall as the
    // input's line box, so showing or dropping the scope can never resize the header.
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    marginRight: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    maxWidth: 220,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  suggestion: { borderStyle: "dashed", backgroundColor: theme.colors.surface0 },
  hovered: { backgroundColor: theme.colors.surface3 },
  scopeChipLabel: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "500",
  },
}));
