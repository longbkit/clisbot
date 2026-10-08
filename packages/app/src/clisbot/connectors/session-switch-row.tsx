import { useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";

export interface SessionRowBadge {
  label: string;
  variant: "muted" | "warning";
}

/**
 * One tool or skill on a page of the session's Tools sheet: what it is, an optional badge (its
 * kind), its switch for this session, and a note under it with a link (why the Project leaves it
 * off, and where to change that). Without `onToggle` the row only shows.
 */
export function SessionSwitchRow({
  id,
  children,
  badge,
  bordered,
  value,
  disabled = false,
  onToggle,
  label,
  note,
  onNote,
  testID,
}: {
  id: string;
  children: ReactNode;
  badge?: SessionRowBadge;
  bordered: boolean;
  value: boolean;
  disabled?: boolean;
  onToggle?(id: string, value: boolean): void | Promise<void>;
  label: string;
  note?: string;
  onNote?(): void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const change = useCallback((next: boolean) => void onToggle?.(id, next), [id, onToggle]);
  return (
    <View style={bordered ? [styles.row, settingsStyles.rowBorder] : styles.row}>
      <View style={disabled ? [styles.content, styles.disabled] : styles.content}>
        {children}
        {note ? (
          <View style={styles.note}>
            <Text style={styles.noteText}>{note}</Text>
            {onNote ? (
              <Pressable accessibilityRole="link" onPress={onNote} hitSlop={6}>
                <Text style={styles.noteLink}>{t("connectors.tools.switchRow.change")}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      {badge ? <StatusBadge label={badge.label} variant={badge.variant} /> : null}
      {onToggle ? (
        <Switch
          value={value}
          disabled={disabled}
          onValueChange={change}
          accessibilityLabel={label}
          testID={testID}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
  },
  content: { flex: 1, minWidth: 0 },
  disabled: { opacity: theme.opacity[50] },
  note: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  noteText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  noteLink: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textDecorationLine: "underline",
  },
}));
