import { useCallback, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/i18next";
import { useChatOptionsState } from "./chat-options-context";

export function conversationHeaderSummary(
  group: boolean,
  members: number,
  hostName: string,
  tabs: number,
) {
  return {
    context: group ? i18n.t("bots.chat.header.members", { count: members }) : hostName,
    tabs: i18n.t("bots.chat.header.tabs", { count: tabs }),
  };
}

export function ConversationHeading({
  avatar,
  title,
  group,
  memberCount,
  hostName,
  tabCount,
}: {
  /** The conversation's mark, the same one its sidebar row shows. */
  avatar: ReactNode;
  title: string;
  group: boolean;
  memberCount: number;
  hostName: string;
  tabCount: number;
}) {
  const { t } = useTranslation();
  const { visible, setVisible } = useChatOptionsState();
  const open = useCallback(() => setVisible(true), [setVisible]);
  const summary = conversationHeaderSummary(group, memberCount, hostName, tabCount);
  return (
    <Pressable
      onPress={open}
      style={styles.heading}
      accessibilityRole="button"
      accessibilityLabel={t("bots.chat.header.accessibilityLabel", { title, ...summary })}
      aria-expanded={visible}
      testID="conversation-header-details"
    >
      {avatar}
      <View style={styles.text}>
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        <View style={styles.summary}>
          <Text numberOfLines={1} style={styles.context}>
            {summary.context}
          </Text>
          <Text style={styles.tabCount}> · {summary.tabs}</Text>
        </View>
      </View>
    </Pressable>
  );
}

// Title and summary read as the conversation's sidebar row: `foreground` medium over
// `foregroundExtraMuted` metadata, beside the same mark.
const styles = StyleSheet.create((theme) => ({
  heading: {
    flexShrink: 1,
    minWidth: 0,
    minHeight: { xs: 48, md: 32 },
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  text: { flexShrink: 1, minWidth: 0, justifyContent: "center" },
  title: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 18,
  },
  summary: { flexDirection: "row", alignItems: "center", minWidth: 0 },
  context: {
    flexShrink: 1,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
  tabCount: {
    flexShrink: 0,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
}));
