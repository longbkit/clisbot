import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check } from "lucide-react-native";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { BotFace } from "./bot-face";

const ThemedCheck = withUnistyles(Check);
const checkedIconMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });

export interface PickerBot {
  id: string;
  name: string;
  description?: string | null;
  avatar?: string | null;
}

/**
 * Choosing a group's members, in New group chat and Group settings alike: one row per bot with
 * its face, name and role, and a checkbox. The whole row toggles.
 */
export function BotMemberPicker({
  bots,
  selected,
  onToggle,
  disabled = false,
  isLocked,
}: {
  bots: readonly PickerBot[];
  selected: ReadonlySet<string>;
  onToggle: (botId: string) => void;
  disabled?: boolean;
  /** A member that cannot be removed right now, such as the last one. */
  isLocked?: (botId: string) => boolean;
}) {
  return (
    <View style={settingsStyles.card}>
      {bots.map((bot, index) => (
        <MemberRow
          key={bot.id}
          bot={bot}
          checked={selected.has(bot.id)}
          disabled={disabled || (isLocked?.(bot.id) ?? false)}
          withBorder={index > 0}
          onToggle={onToggle}
        />
      ))}
    </View>
  );
}

function MemberRow({
  bot,
  checked,
  disabled,
  withBorder,
  onToggle,
}: {
  bot: PickerBot;
  checked: boolean;
  disabled: boolean;
  withBorder: boolean;
  onToggle: (botId: string) => void;
}) {
  const press = useCallback(() => onToggle(bot.id), [bot.id, onToggle]);
  const accessibilityState = useMemo(() => ({ checked, disabled }), [checked, disabled]);
  const rowStyle = useMemo(
    () => [
      settingsStyles.row,
      withBorder ? settingsStyles.rowBorder : null,
      styles.row,
      disabled ? styles.disabled : null,
    ],
    [disabled, withBorder],
  );
  const boxStyle = useMemo(() => [styles.box, checked ? styles.boxChecked : null], [checked]);
  const role = bot.description?.trim();
  return (
    <Pressable
      style={rowStyle}
      onPress={press}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={bot.name}
      accessibilityState={accessibilityState}
      aria-checked={checked}
    >
      <BotFace botId={bot.id} name={bot.name} avatar={bot.avatar} />
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {bot.name}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {role || "No role yet"}
        </Text>
      </View>
      <View style={boxStyle}>
        {checked ? <ThemedCheck size={14} uniProps={checkedIconMapping} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { justifyContent: "flex-start", gap: theme.spacing[3] },
  disabled: { opacity: theme.opacity[50] },
  box: {
    width: 22,
    height: 22,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
}));
