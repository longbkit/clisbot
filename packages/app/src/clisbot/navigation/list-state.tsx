import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CircleAlert, CloudOff, Inbox, type LucideIcon } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { ICON_SIZE, ICON_STROKE_WIDTH } from "@/styles/theme";

type ListStateKind = "empty" | "error" | "offline";
const ICONS: Record<ListStateKind, LucideIcon> = {
  empty: Inbox,
  error: CircleAlert,
  offline: CloudOff,
};

const ThemedIcon = withUnistyles(
  ({ Icon, color }: { Icon: LucideIcon; color?: string }) => (
    <Icon size={ICON_SIZE.lg} color={color} strokeWidth={ICON_STROKE_WIDTH} />
  ),
  (theme) => ({ color: theme.colors.foregroundMuted }),
);

/**
 * What a list shows instead of rows: nothing yet, or nothing because loading failed. Home's feed
 * and Chats draw this one block; Work keeps the sidebar's project empty state, which offers to add
 * a project.
 */
export function ListState({
  kind,
  title,
  action,
  testID,
}: {
  kind: ListStateKind;
  title: string;
  action?: { label: string; onPress(): void };
  testID: string;
}) {
  return (
    <View
      style={styles.state}
      testID={testID}
      accessibilityRole={kind === "empty" ? undefined : "alert"}
    >
      <ThemedIcon Icon={ICONS[kind]} />
      <Text style={styles.title}>{title}</Text>
      {action ? (
        <Button size="sm" variant="outline" onPress={action.onPress} testID={`${testID}-action`}>
          {action.label}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  state: {
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[8],
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
