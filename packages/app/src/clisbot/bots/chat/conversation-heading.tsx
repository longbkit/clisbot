import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ScreenTitle } from "@/components/headers/screen-title";
import { useChatOptionsState } from "./chat-options-context";

export function conversationHeaderSummary(
  group: boolean,
  members: number,
  hostName: string,
  tabs: number,
) {
  return {
    context: group ? `${members} ${members === 1 ? "member" : "members"}` : hostName,
    tabs: `${tabs} ${tabs === 1 ? "tab" : "tabs"}`,
  };
}

export function ConversationHeading({
  title,
  group,
  memberCount,
  hostName,
  tabCount,
}: {
  title: string;
  group: boolean;
  memberCount: number;
  hostName: string;
  tabCount: number;
}) {
  const { visible, setVisible } = useChatOptionsState();
  const open = useCallback(() => setVisible(true), [setVisible]);
  const summary = conversationHeaderSummary(group, memberCount, hostName, tabCount);
  return (
    <Pressable
      onPress={open}
      style={styles.heading}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${summary.context} · ${summary.tabs}. Open chat options`}
      aria-expanded={visible}
      testID="conversation-header-details"
    >
      <ScreenTitle>{title}</ScreenTitle>
      <View style={styles.summary}>
        <Text numberOfLines={1} style={styles.context}>
          {summary.context}
        </Text>
        <Text style={styles.tabCount}> · {summary.tabs}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  heading: {
    flexShrink: 1,
    minWidth: 0,
    minHeight: { xs: 48, md: 32 },
    justifyContent: "center",
    gap: 2,
  },
  summary: { flexDirection: "row", alignItems: "center", minWidth: 0 },
  context: { flexShrink: 1, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  tabCount: { flexShrink: 0, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
