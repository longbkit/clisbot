import { useCallback, useRef, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Plus } from "lucide-react-native";
import { FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { botsCopy } from "../copy";

const ThemedPlus = withUnistyles(Plus);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * "+ New bot": pressed, it becomes a name field; Enter or blur with text hands the name to the
 * create sheet (plans/app.md §5). Blur with nothing typed goes back to the row.
 */
export function NewBotRow({ onCreate }: { onCreate: (name: string) => void }) {
  const isCompact = useIsCompactFormFactor();
  const [editing, setEditing] = useState(false);
  const textRef = useRef("");
  const startEditing = useCallback(() => setEditing(true), []);
  const commit = useCallback(() => {
    const name = textRef.current.trim();
    textRef.current = "";
    setEditing(false);
    if (name) onCreate(name);
  }, [onCreate]);
  const handleChangeText = useCallback((text: string) => {
    textRef.current = text;
  }, []);
  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      hovered && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [],
  );
  if (editing) {
    return (
      <View style={styles.editor} testID="sidebar-new-bot-editor">
        <FormTextInput
          autoFocus
          size={isCompact ? "md" : "sm"}
          placeholder={botsCopy.newBotPlaceholder}
          accessibilityLabel={botsCopy.newBot}
          onChangeText={handleChangeText}
          onSubmitEditing={commit}
          onBlur={commit}
          testID="sidebar-new-bot-name"
        />
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole={isWeb ? undefined : "button"}
      accessibilityLabel={botsCopy.newBot}
      onPress={startEditing}
      style={rowStyle}
      testID="sidebar-new-bot"
    >
      <View style={styles.iconSlot}>
        <ThemedPlus size={14} uniProps={mutedColorMapping} />
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {botsCopy.newBot}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    minHeight: 36,
    marginBottom: theme.spacing[0.5],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    userSelect: "none",
  },
  rowHovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  rowPressed: { backgroundColor: theme.colors.surface2 },
  editor: { minHeight: 36, paddingHorizontal: theme.spacing[2], justifyContent: "center" },
  iconSlot: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base, flexShrink: 1 },
}));
