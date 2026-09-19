// An empty Hub list: what would be here, one line on what it is for, and the
// action that fills it. The same shape as Paseo's Schedules empty state
// (packages/app/src/screens/schedules-screen.tsx), inside the list's card.

import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import { tableStyles } from "./table-styles";

function EmptyIcon({
  icon: Icon,
  color,
  size,
}: {
  icon: LucideIcon;
  color?: string;
  size?: number;
}) {
  return <Icon color={color} size={size} />;
}

const ThemedEmptyIcon = withUnistyles(EmptyIcon, (theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.lg,
}));

export function HubEmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  /** The button that creates the first item; absent when the viewer cannot. */
  action?: ReactNode;
}) {
  return (
    <View style={[settingsStyles.card, tableStyles.body, styles.state]}>
      <ThemedEmptyIcon icon={icon} />
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      {action ?? null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  state: {
    alignItems: "center",
    gap: theme.spacing[4],
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[6],
  },
  text: { alignItems: "center", gap: theme.spacing[2], maxWidth: 420 },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.base, textAlign: "center" },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
}));
